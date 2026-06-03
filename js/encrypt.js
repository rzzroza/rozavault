const Vault = (() => {
  const SALT_SIZE = 16;
  const IV_SIZE = 16;
  const HMAC_SIZE = 32;
  const ARGON2_TIME = 10;
  const ARGON2_MEM = 65536;
  const ARGON2_PARALLEL = 4;
  const MAGIC = new Uint8Array([0x52, 0x4F, 0x5A, 0x41]); // "ROZA"

  function concat(...arrays) {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const res = new Uint8Array(total);
    let offset = 0;
    for (const arr of arrays) { res.set(arr, offset); offset += arr.length; }
    return res;
  }

  async function deriveKeyArgon2(password, salt, keyfileBuffer = null) {
    let combinedPass = password;
    if (keyfileBuffer) {
      const keyfileHash = await crypto.subtle.digest('SHA-256', keyfileBuffer);
      const hashHex = Array.from(new Uint8Array(keyfileHash)).map(b => b.toString(16).padStart(2, '0')).join('');
      combinedPass = password + ':' + hashHex;
    }
    const enc = new TextEncoder();
    const passwordBytes = enc.encode(combinedPass);
    const result = await argon2.hash({
      pass: passwordBytes,
      salt: salt,
      time: ARGON2_TIME,
      mem: ARGON2_MEM,
      parallelism: ARGON2_PARALLEL,
      hashLen: 64,
      type: argon2.ArgonType.Argon2id
    });
    return result.hash;
  }

  async function deriveKeyFallback(password, salt, keyfileBuffer = null) {
    let combinedPass = password;
    if (keyfileBuffer) {
      const keyfileHash = await crypto.subtle.digest('SHA-256', keyfileBuffer);
      const hashHex = Array.from(new Uint8Array(keyfileHash)).map(b => b.toString(16).padStart(2, '0')).join('');
      combinedPass = password + ':' + hashHex;
    }
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(combinedPass), 'PBKDF2', false, ['deriveBits']);
    const derived = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
      keyMaterial, 512
    );
    return new Uint8Array(derived);
  }

  async function encrypt(plaintext, password, keyfileBuffer = null) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_SIZE));
    const iv = crypto.getRandomValues(new Uint8Array(IV_SIZE));
    const derived = (typeof argon2 !== 'undefined') ? await deriveKeyArgon2(password, salt, keyfileBuffer) : await deriveKeyFallback(password, salt, keyfileBuffer);
    const aesKey = await crypto.subtle.importKey('raw', derived.slice(0, 32), 'AES-CBC', false, ['encrypt']);
    const hmacKey = await crypto.subtle.importKey('raw', derived.slice(32, 64), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const plainBytes = concat(MAGIC, new TextEncoder().encode(plaintext));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, aesKey, plainBytes));
    const combined = concat(salt, iv, ciphertext);
    const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, combined));
    return btoa(String.fromCharCode(...concat(combined, hmac)));
  }

  async function decrypt(cipherB64, password, keyfileBuffer = null) {
    const payload = Uint8Array.from(atob(cipherB64), c => c.charCodeAt(0));
    if (payload.length < SALT_SIZE + IV_SIZE + HMAC_SIZE + MAGIC.length) throw new Error('Data corrupt');
    const salt = payload.slice(0, SALT_SIZE);
    const iv = payload.slice(SALT_SIZE, SALT_SIZE + IV_SIZE);
    const hmacStart = payload.length - HMAC_SIZE;
    const ciphertext = payload.slice(SALT_SIZE + IV_SIZE, hmacStart);
    const hmac = payload.slice(hmacStart);
    const derived = (typeof argon2 !== 'undefined') ? await deriveKeyArgon2(password, salt, keyfileBuffer) : await deriveKeyFallback(password, salt, keyfileBuffer);
    const aesKey = await crypto.subtle.importKey('raw', derived.slice(0, 32), 'AES-CBC', false, ['decrypt']);
    const hmacKey = await crypto.subtle.importKey('raw', derived.slice(32, 64), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const combined = payload.slice(0, hmacStart);
    const ok = await crypto.subtle.verify('HMAC', hmacKey, hmac, combined);
    if (!ok) throw new Error('Integrity check failed: wrong password or data tampered');
    const plainBytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, aesKey, ciphertext));
    if (plainBytes.length < MAGIC.length || !MAGIC.every((b, i) => b === plainBytes[i])) throw new Error('Magic bytes mismatch: wrong password');
    return new TextDecoder().decode(plainBytes.slice(MAGIC.length));
  }

  function generateRandomPassword(length = 24) {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+';
    const arr = new Uint8Array(length);
    crypto.getRandomValues(arr);
    return Array.from(arr, x => charset[x % charset.length]).join('');
  }

  return { encrypt, decrypt, generateRandomPassword };
})();