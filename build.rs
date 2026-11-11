// `sqlx::migrate!` embeds migrations and `include_str!` embeds the pages at
// compile time; rebuild when either changes.
fn main() {
    println!("cargo:rerun-if-changed=migrations");
}
