use std::env;
use std::path::Path;
use std::process::Command;

fn kill_process(name: &str) {
  let output = Command::new("killall")
    .arg(name)
    .output()
    .expect("failed to execute process");
  println!("{}", String::from_utf8_lossy(&output.stdout));
}

fn open_app(name: &str) {
  let full_app_name = format!("{}.app", name);
  let output = Command::new("open")
    .arg("-a")
    .arg(full_app_name)
    .output()
    .expect("failed to execute process");
  println!("{}", String::from_utf8_lossy(&output.stdout));
}

fn hpatchz_app(hpatchz_path: &str, delta_path: &str, app_name: &str) {
  let path = Path::new(hpatchz_path);
  let app_path = format!("/Applications/{}.app", app_name);

  let output = Command::new(path)
    .arg("-C-all")
    .arg(&app_path)
    .arg(delta_path)
    .arg(&app_path)
    .arg("-f")
    .output()
    .expect("failed to execute hpatchz process");

  println!("{}", String::from_utf8_lossy(&output.stdout));
}

fn help() {
  println!("Usage: mac-updater <app-name> <delta-path> <hpatchz-path>");
}

fn main() {
  let args: Vec<String> = env::args().collect();

  match args.len() {
    1..=3 => help(),
    4 => {
      let app_name = &args[1];
      let delta_path = &args[2];
      let hpatchz_path = &args[3];

      kill_process(app_name);
      hpatchz_app(hpatchz_path, delta_path, app_name);
      open_app(app_name);
    }
    _ => help(),
  }
}
