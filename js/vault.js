document.addEventListener('DOMContentLoaded', () => {
  // ==================== Validasi Library ====================
  if (typeof argon2 === 'undefined') {
    alert('Argon2 library not found. Please download argon2-browser.min.js and place it in lib/ folder. Vault will use PBKDF2 fallback.');
  }
  if (typeof QRCode === 'undefined') {
    alert('QRCode library not found. QR code generation disabled.');
  }
  if (typeof jsQR === 'undefined') {
    alert('jsQR library not found. QR code scanning disabled.');
  }

  const loadingOverlay = document.getElementById('loadingOverlay');
  function showLoading() { loadingOverlay.classList.remove('hidden'); }
  function hideLoading() { loadingOverlay.classList.add('hidden'); }

  // ==================== Service Worker ====================
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            if (confirm('New version available. Refresh now?')) window.location.reload();
          }
        });
      });
    });
  }

  // ==================== Tab Switching ====================
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
    });
  });

  // ==================== Toggle Password Visibility ====================
  document.querySelectorAll('.toggle-vis').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      target.type = target.type === 'password' ? 'text' : 'password';
      btn.textContent = target.type === 'password' ? 'Show' : 'Hide';
    });
  });

  // ==================== Encrypt Panel ====================
  const encPassword = document.getElementById('encPassword');
  const strengthFill = document.getElementById('strengthFill');
  const strengthLabel = document.getElementById('strengthLabel');
  const encryptBtn = document.getElementById('encryptBtn');
  const weakOverlay = document.getElementById('weakPassConfirm');
  const keyfileInput = document.getElementById('keyfileInput');
  let encKeyfileBuffer = null;
  let forceWeak = false;

  keyfileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) { encKeyfileBuffer = null; return; }
    const reader = new FileReader();
    reader.onload = () => { encKeyfileBuffer = new Uint8Array(reader.result); };
    reader.readAsArrayBuffer(file);
  });

  function updateStrength() {
    const val = encPassword.value;
    let score = 0;
    if (val.length >= 8) score++;
    if (/[A-Z]/.test(val) && /[a-z]/.test(val)) score++;
    if (/\d/.test(val)) score++;
    if (/[^A-Za-z0-9]/.test(val)) score++;
    const pct = (score / 4) * 100;
    strengthFill.style.width = pct + '%';
    if (score <= 1) { strengthFill.style.background = '#e74c3c'; strengthLabel.textContent = 'Weak'; }
    else if (score === 2) { strengthFill.style.background = '#f39c12'; strengthLabel.textContent = 'Fair'; }
    else if (score === 3) { strengthFill.style.background = '#2ecc71'; strengthLabel.textContent = 'Strong'; }
    else { strengthFill.style.background = '#27ae60'; strengthLabel.textContent = 'Very strong'; }
    if (val.length === 0) { strengthFill.style.width = '0'; strengthLabel.textContent = ''; }

    if (score >= 3 || forceWeak) encryptBtn.disabled = false;
    else encryptBtn.disabled = true;
    if (score <= 2 && val.length > 0 && !forceWeak) weakOverlay.classList.remove('hidden');
    else weakOverlay.classList.add('hidden');
  }
  encPassword.addEventListener('input', updateStrength);

  document.getElementById('weakPassYes').addEventListener('click', () => {
    forceWeak = true;
    encryptBtn.disabled = false;
    weakOverlay.classList.add('hidden');
  });
  document.getElementById('weakPassNo').addEventListener('click', () => {
    weakOverlay.classList.add('hidden');
  });

  document.getElementById('generatePassBtn').addEventListener('click', () => {
    const pass = Vault.generateRandomPassword();
    encPassword.value = pass;
    encPassword.type = 'text';
    document.querySelector('.toggle-vis[data-target="encPassword"]').textContent = 'Hide';
    updateStrength();
  });

  function clearEncrypt() {
    document.getElementById('seedInput').value = '';
    encPassword.value = '';
    encPassword.type = 'password';
    document.querySelector('.toggle-vis[data-target="encPassword"]').textContent = 'Show';
    keyfileInput.value = '';
    encKeyfileBuffer = null;
    document.getElementById('encryptResult').classList.add('hidden');
    document.getElementById('qrCodeContainer').innerHTML = '';
    forceWeak = false;
    updateStrength();
  }
  document.getElementById('clearEncryptBtn').addEventListener('click', clearEncrypt);

  encryptBtn.addEventListener('click', async () => {
    const seed = document.getElementById('seedInput').value.trim();
    const pass = encPassword.value;
    if (!seed || !pass) return alert('Please fill all fields');
    showLoading();
    encryptBtn.disabled = true;
    try {
      const cipher = await Vault.encrypt(seed, pass, encKeyfileBuffer);
      const url = window.location.href.split('#')[0] + '#' + encodeURIComponent(cipher);
      document.getElementById('encryptedUrlOutput').value = url;

      const qrContainer = document.getElementById('qrCodeContainer');
      qrContainer.innerHTML = '';
      if (typeof QRCode !== 'undefined') {
        new QRCode(qrContainer, {
          text: url,
          width: 200,
          height: 200,
          correctLevel: QRCode.CorrectLevel.M
        });
      } else {
        qrContainer.innerHTML = '<p class="hint">QR library not loaded.</p>';
      }

      document.getElementById('encryptResult').classList.remove('hidden');
    } catch (e) { alert('Encryption error: ' + e.message); }
    finally {
      hideLoading();
      encryptBtn.disabled = false;
      updateStrength();
    }
  });

  // ==================== Decrypt Panel ====================
  const qrScanInput = document.getElementById('qrScanInput');
  qrScanInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.src = reader.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
        const imageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        if (typeof jsQR !== 'undefined') {
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code) {
            document.getElementById('encryptedUrl').value = code.data;
          } else {
            alert('No QR code found in image.');
          }
        } else {
          alert('QR scanning library not loaded.');
        }
      };
      img.onerror = () => alert('Failed to load image. Please ensure it is a valid image file.');
    };
    reader.readAsDataURL(file);
  });

  const decKeyfileInput = document.getElementById('decKeyfileInput');
  let decKeyfileBuffer = null;
  decKeyfileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) { decKeyfileBuffer = null; return; }
    const reader = new FileReader();
    reader.onload = () => { decKeyfileBuffer = new Uint8Array(reader.result); };
    reader.readAsArrayBuffer(file);
  });

  let pendingDecrypt = null;
  let decryptTimer = null;

  function clearDecrypt() {
    document.getElementById('encryptedUrl').value = '';
    document.getElementById('decPassword').value = '';
    decKeyfileInput.value = '';
    decKeyfileBuffer = null;
    document.getElementById('confirmReveal').classList.add('hidden');
    document.getElementById('decryptResult').classList.add('hidden');
    pendingDecrypt = null;
    if (decryptTimer) clearTimeout(decryptTimer);
  }
  document.getElementById('clearDecryptBtn').addEventListener('click', clearDecrypt);

  document.getElementById('decryptBtn').addEventListener('click', async () => {
    const urlInput = document.getElementById('encryptedUrl').value.trim();
    const pass = document.getElementById('decPassword').value;
    if (!urlInput || !pass) return alert('Please fill all fields');
    showLoading();
    try {
      const hash = urlInput.includes('#') ? urlInput.split('#')[1] : urlInput;
      const seed = await Vault.decrypt(decodeURIComponent(hash), pass, decKeyfileBuffer);
      pendingDecrypt = seed;
      document.getElementById('confirmReveal').classList.remove('hidden');
    } catch (e) { alert('Decryption failed: ' + e.message); }
    finally { hideLoading(); }
  });

  document.getElementById('revealYes').addEventListener('click', () => {
    if (!pendingDecrypt) return;
    document.getElementById('decryptedSeedOutput').value = pendingDecrypt;
    document.getElementById('decryptResult').classList.remove('hidden');
    document.getElementById('confirmReveal').classList.add('hidden');
    pendingDecrypt = null;
    decryptTimer = setTimeout(clearDecrypt, 60000);
    window.addEventListener('blur', clearDecrypt, { once: true });
  });

  document.getElementById('revealNo').addEventListener('click', () => {
    document.getElementById('confirmReveal').classList.add('hidden');
    pendingDecrypt = null;
  });

  // ==================== Multi-Seed Vault ====================
  let vaultData = {};

  function renderSeedList() {
    const container = document.getElementById('seedList');
    container.innerHTML = Object.keys(vaultData).map(label =>
      `<div class="seed-item"><span>${label}</span><button data-label="${label}" class="btn-icon view-seed">View</button></div>`
    ).join('');

    document.querySelectorAll('.view-seed').forEach(btn => {
      btn.addEventListener('click', async () => {
        const label = btn.dataset.label;
        const pass = document.getElementById('vaultMasterPass').value;
        if (!pass) return alert('Enter master password first');
        const kfFile = document.getElementById('vaultKeyfile').files[0];
        let kfBuffer = null;
        if (kfFile) {
          kfBuffer = await new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve(new Uint8Array(reader.result));
            reader.readAsArrayBuffer(kfFile);
          });
        }
        showLoading();
        try {
          const seed = await Vault.decrypt(vaultData[label], pass, kfBuffer);
          document.getElementById('multiSeedOutput').value = seed;
          document.getElementById('multiSeedResult').classList.remove('hidden');
          if (window.multiSeedTimer) clearTimeout(window.multiSeedTimer);
          window.multiSeedTimer = setTimeout(() => {
            document.getElementById('multiSeedResult').classList.add('hidden');
            document.getElementById('multiSeedOutput').value = '';
          }, 30000);
        } catch (e) { alert('Failed to decrypt: ' + e.message); }
        finally { hideLoading(); }
      });
    });
  }

  document.getElementById('addSeedBtn').addEventListener('click', async () => {
    const label = document.getElementById('vaultLabel').value.trim();
    const seed = document.getElementById('vaultSeed').value.trim();
    const pass = document.getElementById('vaultMasterPass').value;
    const kfFile = document.getElementById('vaultKeyfile').files[0];
    if (!label || !seed || !pass) return alert('Fill all fields');
    showLoading();
    try {
      let kfBuffer = null;
      if (kfFile) {
        kfBuffer = await new Promise(resolve => {
          const reader = new FileReader();
          reader.onload = () => resolve(new Uint8Array(reader.result));
          reader.readAsArrayBuffer(kfFile);
        });
      }
      const enc = await Vault.encrypt(seed, pass, kfBuffer);
      vaultData[label] = enc;
      renderSeedList();
      document.getElementById('vaultLabel').value = '';
      document.getElementById('vaultSeed').value = '';
    } catch (e) { alert('Encryption error: ' + e.message); }
    finally { hideLoading(); }
  });

  document.getElementById('exportVaultBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(vaultData)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rozaVault_backup.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('importVaultBtn').addEventListener('click', () => {
    document.getElementById('importVaultFile').click();
  });
  document.getElementById('importVaultFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        vaultData = JSON.parse(reader.result);
        renderSeedList();
        alert('Vault imported successfully.');
      } catch { alert('Invalid vault file.'); }
    };
    reader.readAsText(file);
  });

  // ==================== Copy Buttons ====================
  function setupCopy(btnId, sourceId) {
    document.getElementById(btnId).addEventListener('click', async () => {
      const el = document.getElementById(sourceId);
      el.select();
      try {
        await navigator.clipboard.writeText(el.value);
      } catch (err) {
        document.execCommand('copy');
      }
      const btn = document.getElementById(btnId);
      btn.textContent = 'Copied';
      setTimeout(() => btn.textContent = 'Copy', 1500);
    });
  }
  setupCopy('copyUrlBtn', 'encryptedUrlOutput');
  setupCopy('copySeedBtn', 'decryptedSeedOutput');
  setupCopy('copyMultiSeedBtn', 'multiSeedOutput');

  // ==================== Audit Panel ====================
  async function computeFileHash(url) {
    const resp = await fetch(url);
    const buffer = await resp.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function performAudit() {
    const files = ['index.html', 'js/encrypt.js', 'js/vault.js', 'css/style.css'];
    const results = [];
    for (const f of files) {
      try {
        const hash = await computeFileHash(f);
        results.push(`${f}: ${hash.substring(0, 12)}...`);
      } catch { results.push(`${f}: ERROR (file not found or blocked)`); }
    }
    document.getElementById('auditResults').innerHTML = results.join('<br>');
    document.getElementById('auditPanel').classList.remove('hidden');
  }

  document.getElementById('auditBtn').addEventListener('click', performAudit);
  document.getElementById('footerAuditLink').addEventListener('click', (e) => { e.preventDefault(); performAudit(); });
  document.getElementById('closeAudit').addEventListener('click', () => {
    document.getElementById('auditPanel').classList.add('hidden');
  });

  // ==================== Initial Clean ====================
  window.addEventListener('beforeunload', () => {
    clearEncrypt();
    clearDecrypt();
    document.getElementById('multiSeedResult').classList.add('hidden');
  });
});