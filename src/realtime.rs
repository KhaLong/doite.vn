//! Đẩy sự kiện thời gian thực tới trình duyệt bằng Server-Sent Events (GET /api/events).
//!
//! Mỗi người dùng có một kênh broadcast trong bộ nhớ; mọi tab của họ cùng nghe kênh đó.
//! Sự kiện: `ready` (lúc nối, kèm số chưa đọc), `message`, `read`, `typing`, `unread`, `resync`
//! (tab nghe chậm bị lỡ sự kiện → tải lại cho đủ).
//!
//! Giới hạn: một tiến trình server. Chạy nhiều tiến trình thì thay Hub bằng pub/sub chung
//! (Redis, NATS…) — giao diện `publish` / `subscribe` giữ nguyên.

use std::{collections::HashMap, convert::Infallible, sync::Mutex, time::Duration};

use axum::{
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{
        IntoResponse, Response,
        sse::{Event, KeepAlive, Sse},
    },
};
use futures_util::stream::{self, Stream, StreamExt};
use serde::Serialize;
use tokio::sync::broadcast;

use crate::auth::{self, AppState};

/// Sự kiện chờ trong kênh của một người; tab chậm hơn chừng này thì nhận `resync`.
const CHANNEL_CAPACITY: usize = 64;
/// Số tab (kết nối) cùng lúc tối đa mỗi người — chặn mở vô hạn kết nối.
const MAX_CONNECTIONS_PER_USER: usize = 8;

#[derive(Clone, Debug)]
pub struct Push {
    pub event: &'static str,
    pub data: String,
}

#[derive(Default)]
pub struct Hub {
    channels: Mutex<HashMap<u64, broadcast::Sender<Push>>>,
}

impl Hub {
    fn subscribe(&self, user_id: u64) -> Option<broadcast::Receiver<Push>> {
        let mut channels = self.channels.lock().unwrap_or_else(|e| e.into_inner());
        // Dọn kênh của người đã đóng hết tab (không để bản đồ phình mãi)
        channels.retain(|_, sender| sender.receiver_count() > 0);
        let sender = channels.entry(user_id).or_insert_with(|| broadcast::channel(CHANNEL_CAPACITY).0);
        (sender.receiver_count() < MAX_CONNECTIONS_PER_USER).then(|| sender.subscribe())
    }

    /// Gửi tới mọi tab đang mở của một người. Không ai nghe thì bỏ qua (và dọn kênh rỗng).
    pub fn publish(&self, user_id: u64, event: &'static str, payload: &impl Serialize) {
        let Ok(data) = serde_json::to_string(payload) else { return };
        let mut channels = self.channels.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(sender) = channels.get(&user_id) {
            if sender.receiver_count() == 0 {
                channels.remove(&user_id);
            } else {
                let _ = sender.send(Push { event, data });
            }
        }
    }

    /// Đóng mọi kênh (lúc tắt server): các dòng SSE kết thúc, trình duyệt tự nối lại vào server mới.
    pub fn close_all(&self) {
        self.channels.lock().unwrap_or_else(|e| e.into_inner()).clear();
    }

    #[cfg(test)]
    fn connections(&self, user_id: u64) -> usize {
        self.channels
            .lock()
            .unwrap()
            .get(&user_id)
            .map_or(0, broadcast::Sender::receiver_count)
    }
}

fn to_event(push: Push) -> Event {
    Event::default().event(push.event).data(push.data)
}

/// Dòng sự kiện của một người từ một kênh broadcast (không cần đăng nhập — dùng trong test).
fn event_stream(first: Push, receiver: broadcast::Receiver<Push>) -> impl Stream<Item = Result<Event, Infallible>> {
    let rest = stream::unfold(receiver, |mut receiver| async move {
        match receiver.recv().await {
            Ok(push) => Some((Ok(to_event(push)), receiver)),
            // Tab nghe chậm, kênh đã đẩy qua: báo tải lại thay vì lặng lẽ mất tin
            Err(broadcast::error::RecvError::Lagged(_)) => Some((Ok(Event::default().event("resync").data("{}")), receiver)),
            Err(broadcast::error::RecvError::Closed) => None,
        }
    });
    stream::once(async move { Ok(to_event(first)) }).chain(rest)
}

/// GET /api/events — cần đăng nhập. Trình duyệt dùng `EventSource`, tự nối lại khi rớt mạng.
pub async fn events(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let user_id = match auth::current_user_id(&state.db, &headers).await {
        Ok(Some(id)) => id,
        Ok(None) => return StatusCode::UNAUTHORIZED.into_response(),
        Err(e) => {
            eprintln!("events auth: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    let Some(receiver) = state.hub.subscribe(user_id) else {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    };
    let unread = crate::messages::unread_count(&state.db, user_id).await.unwrap_or(0);
    let ready = Push { event: "ready", data: serde_json::json!({ "unread": unread }).to_string() };
    let mut response = Sse::new(event_stream(ready, receiver))
        .keep_alive(KeepAlive::new().interval(Duration::from_secs(20)).text("ping"))
        .into_response();
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    // nginx: không gom sự kiện lại (đẩy ngay)
    headers.insert(header::HeaderName::from_static("x-accel-buffering"), HeaderValue::from_static("no"));
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn publish_reaches_every_tab_of_that_user_only() {
        let hub = Hub::default();
        let mut tab1 = hub.subscribe(1).unwrap();
        let mut tab2 = hub.subscribe(1).unwrap();
        let mut other = hub.subscribe(2).unwrap();
        hub.publish(1, "message", &serde_json::json!({ "id": 7 }));
        assert_eq!(tab1.recv().await.unwrap().data, r#"{"id":7}"#);
        assert_eq!(tab2.recv().await.unwrap().event, "message");
        assert!(other.try_recv().is_err());
    }

    #[test]
    fn connections_are_capped_and_released() {
        let hub = Hub::default();
        let tabs: Vec<_> = (0..MAX_CONNECTIONS_PER_USER).map(|_| hub.subscribe(1).unwrap()).collect();
        assert!(hub.subscribe(1).is_none());
        drop(tabs);
        assert_eq!(hub.connections(1), 0);
        assert!(hub.subscribe(1).is_some());
    }

    #[tokio::test]
    async fn close_all_ends_streams_so_server_can_shut_down() {
        let hub = Hub::default();
        let receiver = hub.subscribe(1).unwrap();
        let ready = Push { event: "ready", data: "{}".into() };
        let mut stream = Box::pin(event_stream(ready, receiver));
        let _ready = stream.next().await.unwrap();
        hub.close_all();
        assert!(stream.next().await.is_none());
    }

    #[tokio::test]
    async fn slow_tab_gets_resync_instead_of_silent_loss() {
        let hub = Hub::default();
        let receiver = hub.subscribe(1).unwrap();
        for i in 0..(CHANNEL_CAPACITY + 5) {
            hub.publish(1, "message", &i);
        }
        let ready = Push { event: "ready", data: "{}".into() };
        let mut stream = Box::pin(event_stream(ready, receiver));
        let _ready = stream.next().await.unwrap();
        // Sự kiện kế tiếp phải là resync (đã lỡ sự kiện), không phải nhảy cóc im lặng
        let next = format!("{:?}", stream.next().await.unwrap().unwrap());
        assert!(next.contains("resync"), "{next}");
    }
}
