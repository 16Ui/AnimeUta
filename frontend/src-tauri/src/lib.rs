use std::fs;
use std::path::PathBuf;

const CREDENTIAL_FILE_VERSION: &str = "animeuta-local-credential-v1";

#[derive(serde::Serialize, serde::Deserialize)]
struct SavedLogin {
  email: String,
  password: String,
}

fn scoped_path() -> Result<PathBuf, String> {
  Ok(credential_file_path()?.with_file_name("saved-logins-v2.bin"))
}

fn read_scoped_logins() -> Result<std::collections::BTreeMap<String, SavedLogin>, String> {
  let path = scoped_path()?;
  if !path.exists() { return Ok(Default::default()); }
  let bytes = fs::read(path).map_err(|e| e.to_string())?;
  serde_json::from_slice(&unprotect_bytes(&bytes)?).map_err(|e| e.to_string())
}

fn write_scoped_logins(logins: &std::collections::BTreeMap<String, SavedLogin>) -> Result<(), String> {
  let path = scoped_path()?;
  if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
  let bytes = serde_json::to_vec(logins).map_err(|e| e.to_string())?;
  let temporary = path.with_extension("tmp");
  fs::write(&temporary, protect_bytes(&bytes)?).map_err(|e| e.to_string())?;
  fs::rename(temporary, path).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_scoped_login(server: String) -> Result<Option<SavedLogin>, String> {
  Ok(read_scoped_logins()?.remove(&server))
}

#[tauri::command]
fn save_scoped_login(server: String, email: String, password: String) -> Result<(), String> {
  if server.is_empty() || password.is_empty() { return Err("invalid_credentials".into()); }
  let mut logins = read_scoped_logins()?;
  logins.insert(server, SavedLogin { email: normalize_email(&email)?, password });
  write_scoped_logins(&logins)
}

#[tauri::command]
fn delete_scoped_login(server: String) -> Result<(), String> {
  let mut logins = read_scoped_logins()?;
  logins.remove(&server);
  write_scoped_logins(&logins)
}

fn normalize_email(email: &str) -> Result<String, String> {
  let account = email.trim().to_lowercase();
  if account.is_empty() {
    return Err("email_required".to_string());
  }
  Ok(account)
}

fn credential_file_path() -> Result<PathBuf, String> {
  #[cfg(test)]
  if let Some(base) = std::env::var_os("ANIMEUTA_CREDENTIAL_TEST_DIR") {
    return Ok(PathBuf::from(base).join("saved-login.bin"));
  }
  let base = std::env::var_os("LOCALAPPDATA")
    .or_else(|| std::env::var_os("APPDATA"))
    .ok_or_else(|| "app_data_directory_unavailable".to_string())?;
  Ok(PathBuf::from(base)
    .join("app.animeuta.desktop")
    .join("saved-login.bin"))
}

#[cfg(target_os = "windows")]
fn protect_bytes(plaintext: &[u8]) -> Result<Vec<u8>, String> {
  use windows_sys::Win32::Foundation::LocalFree;
  use windows_sys::Win32::Security::Cryptography::{
    CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
  };

  let mut input = CRYPT_INTEGER_BLOB {
    cbData: plaintext.len() as u32,
    pbData: plaintext.as_ptr() as *mut u8,
  };
  let mut output = CRYPT_INTEGER_BLOB::default();
  let succeeded = unsafe {
    CryptProtectData(
      &mut input,
      std::ptr::null(),
      std::ptr::null(),
      std::ptr::null(),
      std::ptr::null(),
      CRYPTPROTECT_UI_FORBIDDEN,
      &mut output,
    )
  };
  if succeeded == 0 {
    return Err(std::io::Error::last_os_error().to_string());
  }

  let encrypted = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
  unsafe {
    LocalFree(output.pbData as *mut std::ffi::c_void);
  }
  Ok(encrypted)
}

#[cfg(target_os = "windows")]
fn unprotect_bytes(encrypted: &[u8]) -> Result<Vec<u8>, String> {
  use windows_sys::Win32::Foundation::LocalFree;
  use windows_sys::Win32::Security::Cryptography::{
    CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
  };

  let mut input = CRYPT_INTEGER_BLOB {
    cbData: encrypted.len() as u32,
    pbData: encrypted.as_ptr() as *mut u8,
  };
  let mut output = CRYPT_INTEGER_BLOB::default();
  let succeeded = unsafe {
    CryptUnprotectData(
      &mut input,
      std::ptr::null_mut(),
      std::ptr::null(),
      std::ptr::null(),
      std::ptr::null(),
      CRYPTPROTECT_UI_FORBIDDEN,
      &mut output,
    )
  };
  if succeeded == 0 {
    return Err(std::io::Error::last_os_error().to_string());
  }

  let plaintext = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
  unsafe {
    LocalFree(output.pbData as *mut std::ffi::c_void);
  }
  Ok(plaintext)
}

#[cfg(not(target_os = "windows"))]
fn protect_bytes(_plaintext: &[u8]) -> Result<Vec<u8>, String> {
  Err("local_credential_storage_unsupported".to_string())
}

#[cfg(not(target_os = "windows"))]
fn unprotect_bytes(_encrypted: &[u8]) -> Result<Vec<u8>, String> {
  Err("local_credential_storage_unsupported".to_string())
}

#[tauri::command]
fn load_saved_password(email: String) -> Result<Option<String>, String> {
  let account = normalize_email(&email)?;
  Ok(read_saved_login_file()?
    .filter(|login| login.email == account)
    .map(|login| login.password))
}

#[tauri::command]
fn load_saved_login() -> Result<Option<SavedLogin>, String> {
  read_saved_login_file()
}

fn read_saved_login_file() -> Result<Option<SavedLogin>, String> {
  let path = credential_file_path()?;
  if !path.exists() {
    return Ok(None);
  }

  let encrypted = fs::read(path).map_err(|error| error.to_string())?;
  let plaintext = String::from_utf8(unprotect_bytes(&encrypted)?).map_err(|error| error.to_string())?;
  let mut fields = plaintext.splitn(3, '\n');
  if fields.next() != Some(CREDENTIAL_FILE_VERSION) {
    return Ok(None);
  }
  let email = fields.next().ok_or_else(|| "invalid_saved_login".to_string())?.to_string();
  let password = fields.next().ok_or_else(|| "invalid_saved_login".to_string())?.to_string();
  Ok(Some(SavedLogin { email, password }))
}

#[tauri::command]
fn save_login_password(email: String, password: String) -> Result<(), String> {
  let account = normalize_email(&email)?;
  if password.is_empty() {
    return Err("password_required".to_string());
  }

  let path = credential_file_path()?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
  }
  let plaintext = format!("{CREDENTIAL_FILE_VERSION}\n{account}\n{password}");
  fs::write(path, protect_bytes(plaintext.as_bytes())?).map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_saved_password(email: String) -> Result<(), String> {
  normalize_email(&email)?;
  let path = credential_file_path()?;
  match fs::remove_file(path) {
    Ok(()) => Ok(()),
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
    Err(error) => Err(error.to_string()),
  }
}

#[tauri::command]
fn open_release_download() -> Result<(), String> {
  #[cfg(target_os = "windows")]
  {
    std::process::Command::new("explorer.exe")
      .arg("https://server.example.invalid/downloads/windows/AnimeUta-Setup.exe")
      .spawn().map_err(|error| error.to_string())?;
    Ok(())
  }
  #[cfg(not(target_os = "windows"))]
  { Err("This release channel supports Windows only".into()) }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      open_release_download,
      load_scoped_login,
      save_scoped_login,
      delete_scoped_login,
      load_saved_password,
      load_saved_login,
      save_login_password,
      delete_saved_password,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
  use super::*;

  #[test]
  fn scoped_credentials_persist_and_remain_isolated() {
    // Require an explicitly isolated directory; never touch a user's saved login.
    assert!(std::env::var_os("ANIMEUTA_CREDENTIAL_TEST_DIR").is_some());
    let a = "https://desktop-credential-test.invalid/a".to_string();
    let b = "https://desktop-credential-test.invalid/b".to_string();
    save_scoped_login(a.clone(), "QA@example.invalid".into(), "test-password-a".into()).unwrap();
    save_scoped_login(b.clone(), "second@example.invalid".into(), "test-password-b".into()).unwrap();
    assert_eq!(load_scoped_login(a.clone()).unwrap().unwrap().password, "test-password-a");
    assert_eq!(load_scoped_login(b.clone()).unwrap().unwrap().password, "test-password-b");
    let encrypted = fs::read(scoped_path().unwrap()).unwrap();
    assert!(!String::from_utf8_lossy(&encrypted).contains("test-password"));
    save_scoped_login(a.clone(), "qa@example.invalid".into(), "updated-password".into()).unwrap();
    assert_eq!(load_scoped_login(a.clone()).unwrap().unwrap().password, "updated-password");
    delete_scoped_login(a.clone()).unwrap();
    assert!(load_scoped_login(a).unwrap().is_none());
    assert!(load_scoped_login(b.clone()).unwrap().is_some());
    delete_scoped_login(b).unwrap();
  }

  #[test]
  fn local_credential_encryption_round_trips() {
    let plaintext = b"animeuta credential round trip";
    let encrypted = protect_bytes(plaintext).expect("credential encryption should succeed");
    assert_ne!(encrypted, plaintext);
    assert_eq!(unprotect_bytes(&encrypted).expect("credential decryption should succeed"), plaintext);
  }
}
