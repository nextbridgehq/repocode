mod config;
use crate::config::Settings;
use self::utils;
use std::io::Read;
extern crate serde;

fn main() {
    let _s = Settings::new();
}
