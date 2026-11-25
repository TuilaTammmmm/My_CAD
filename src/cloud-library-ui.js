import {
  fetchCloudModels,
  loadCloudModelData,
  saveCloudModel,
  verifyAdminPin,
  deleteCloudModel,
  getOwnDeleteToken,
  removeOwnDeleteToken,
  getStoredAdminPin,
  setStoredAdminPin
} from './cloud-library.js';

function formatShortDate(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '';
  }
}

function createBadge(text) {
  const span = document.createElement('span');
  span.className = 'cloud-badge';
  span.textContent = text;
  return span;
}

/**
 * Khởi tạo giao diện & sự kiện cho Modal Thư viện CAD dùng chung.
 */
export function initCloudLibraryUI({ getPayload, applyPayload }) {
  const modal = document.getElementById('cloud-lib-modal');
  const grid = document.getElementById('cloud-models-grid');
  const statusEl = document.getElementById('cloud-lib-status');
  const nameInput = document.getElementById('cloud-save-name');
  const authorInput = document.getElementById('cloud-save-author');
  const chk3d = document.getElementById('cloud-chk-3d');
  const chk2d = document.getElementById('cloud-chk-2d');
  const chkScript = document.getElementById('cloud-chk-script');
  const btnSave = document.getElementById('btn-cloud-save');
  const searchInput = document.getElementById('cloud-search-input');
  const btnRefresh = document.getElementById('btn-cloud-refresh');
  const btnAdminToggle = document.getElementById('btn-cloud-admin-toggle');
  const adminBar = document.getElementById('cloud-admin-bar');
  const adminPinInput = document.getElementById('cloud-admin-pin-input');
  const btnAdminLogin = document.getElementById('btn-cloud-admin-login');
  const btnAdminLogout = document.getElementById('btn-cloud-admin-logout');

  if (!modal || !grid) return;

  let cachedModels = [];
  let isAdminActive = Boolean(getStoredAdminPin());

  function setStatus(message, type = 'info') {
    if (!statusEl) return;
    if (!message) {
      statusEl.style.display = 'none';
      statusEl.textContent = '';
      return;
    }
    statusEl.textContent = message;
    statusEl.className = `cloud-lib-status ${type}`;
    statusEl.style.display = 'block';
  }

  function syncAdminUI() {
    if (btnAdminToggle) {
      btnAdminToggle.classList.toggle('active', isAdminActive);
      btnAdminToggle.textContent = isAdminActive ? '🔓 Admin: BẬT' : '🔑 Admin';
    }
    if (btnAdminLogin) btnAdminLogin.style.display = isAdminActive ? 'none' : 'inline-block';
    if (adminPinInput) adminPinInput.style.display = isAdminActive ? 'none' : 'inline-block';
    if (btnAdminLogout) btnAdminLogout.style.display = isAdminActive ? 'inline-block' : 'none';
  }

  function renderModels() {
    const keyword = (searchInput?.value || '').trim().toLowerCase();
    const filtered = keyword
      ? cachedModels.filter((m) =>
          (m.name || '').toLowerCase().includes(keyword) ||
          (m.author || '').toLowerCase().includes(keyword)
        )
      : cachedModels;

    grid.replaceChildren();

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cloud-empty-state';
      empty.textContent = keyword
        ? 'Không tìm thấy mẫu CAD nào khớp với từ khóa.'
        : 'Chưa có mẫu nào trên thư viện. Hãy nhập tên ở trên và bấm "Lưu lên Thư viện"!';
      grid.appendChild(empty);
      return;
    }

    for (const model of filtered) {
      const card = document.createElement('div');
      card.className = 'cloud-model-card';

      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'cloud-card-thumb';
      if (
        typeof model.thumbnail === 'string' &&
        /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(model.thumbnail)
      ) {
        const img = document.createElement('img');
        img.src = model.thumbnail;
        img.alt = model.name || 'CAD preview';
        thumbWrap.appendChild(img);
      } else {
        const noThumb = document.createElement('span');
        noThumb.className = 'cloud-card-thumb-empty';
        noThumb.textContent = 'Không có ảnh xem trước';
        thumbWrap.appendChild(noThumb);
      }
      card.appendChild(thumbWrap);

      const body = document.createElement('div');
      body.className = 'cloud-card-body';

      const title = document.createElement('div');
      title.className = 'cloud-card-title';
      title.title = model.name || '';
      title.textContent = model.name || 'Mẫu chưa đặt tên';
      body.appendChild(title);

      const meta = document.createElement('div');
      meta.className = 'cloud-card-meta';
      const authorEl = document.createElement('span');
      authorEl.textContent = `👤 ${model.author || 'Ẩn danh'}`;
      const dateEl = document.createElement('span');
      dateEl.textContent = formatShortDate(model.createdAt);
      meta.append(authorEl, dateEl);
      body.appendChild(meta);

      const ownToken = getOwnDeleteToken(model.id);

      const badges = document.createElement('div');
      badges.className = 'cloud-card-badges';
      if (ownToken) {
        const ownBadge = createBadge('Của bạn');
        ownBadge.classList.add('cloud-badge-own');
        badges.appendChild(ownBadge);
      }
      if (model.has3D && model.dims) {
        badges.appendChild(createBadge(`3D ${model.dims.w}×${model.dims.h}×${model.dims.d}`));
      } else if (model.has3D) {
        badges.appendChild(createBadge('3D'));
      }
      if (model.has2D) badges.appendChild(createBadge('2D'));
      if (model.hasScript) badges.appendChild(createBadge('Script'));
      body.appendChild(badges);

      const actions = document.createElement('div');
      actions.className = 'cloud-card-actions';

      const btnOpen = document.createElement('button');
      btnOpen.type = 'button';
      btnOpen.className = 'btn-cloud-primary';
      btnOpen.textContent = 'Mở dùng ngay';
      btnOpen.addEventListener('click', async () => {
        btnOpen.disabled = true;
        const prev = btnOpen.textContent;
        btnOpen.textContent = 'Đang tải...';
        try {
          const data = await loadCloudModelData(model.dataUrl);
          await applyPayload(data, model);
          modal.style.display = 'none';
        } catch (err) {
          setStatus(err.message || 'Không thể mở mẫu CAD này.', 'error');
        } finally {
          btnOpen.disabled = false;
          btnOpen.textContent = prev;
        }
      });
      actions.appendChild(btnOpen);

      if (isAdminActive || ownToken) {
        const btnDel = document.createElement('button');
        btnDel.type = 'button';
        btnDel.className = 'btn-cloud-danger';
        btnDel.title = isAdminActive ? 'Xóa bằng quyền Admin' : 'Tự xóa bài của bản thân';
        btnDel.textContent = isAdminActive ? '🗑️' : '🗑️ Xóa';
        btnDel.addEventListener('click', async () => {
          const confirmMsg = `Xóa mẫu "${model.name}" khỏi thư viện chung?`;
          if (!window.confirm(confirmMsg)) return;
          btnDel.disabled = true;
          try {
            await deleteCloudModel(model.id, {
              adminPin: isAdminActive ? getStoredAdminPin() : '',
              deleteToken: ownToken
            });
            cachedModels = cachedModels.filter((m) => m.id !== model.id);
            renderModels();
            setStatus(`Đã xóa mẫu "${model.name}".`, 'success');
          } catch (err) {
            if (err.status === 401) {
              if (isAdminActive) {
                setStoredAdminPin('');
                isAdminActive = false;
                syncAdminUI();
              }
              if (ownToken) {
                removeOwnDeleteToken(model.id);
              }
              renderModels();
            }
            setStatus(err.message || 'Xóa mẫu thất bại.', 'error');
            btnDel.disabled = false;
          }
        });
        actions.appendChild(btnDel);
      }

      body.appendChild(actions);
      card.appendChild(body);
      grid.appendChild(card);
    }
  }

  async function refreshModels() {
    setStatus('Đang tải danh sách mẫu từ thư viện...', 'info');
    try {
      cachedModels = await fetchCloudModels();
      setStatus('');
      renderModels();
    } catch (err) {
      cachedModels = [];
      grid.replaceChildren();
      const empty = document.createElement('div');
      empty.className = 'cloud-empty-state';
      empty.textContent = err.message || 'Không kết nối được tới thư viện.';
      grid.appendChild(empty);
      setStatus(err.message || 'Không kết nối được tới thư viện.', 'error');
    }
  }

  function openModal() {
    modal.style.display = 'flex';
    syncAdminUI();
    refreshModels();
  }

  document.getElementById('btn-open-cloud-lib')?.addEventListener('click', openModal);
  document.getElementById('btn-open-cloud-lib-2d')?.addEventListener('click', openModal);
  document.getElementById('btn-close-cloud-lib')?.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  btnRefresh?.addEventListener('click', refreshModels);
  searchInput?.addEventListener('input', renderModels);

  btnSave?.addEventListener('click', async () => {
    const name = (nameInput?.value || '').trim();
    if (!name) {
      setStatus('Vui lòng nhập tên mẫu CAD trước khi lưu.', 'error');
      nameInput?.focus();
      return;
    }

    btnSave.disabled = true;
    const prevText = btnSave.textContent;
    btnSave.textContent = '⏳ Đang lưu...';
    setStatus('Đang đóng gói và tải bài CAD lên thư viện...', 'info');

    try {
      const payload = await getPayload({
        name,
        author: (authorInput?.value || '').trim(),
        include3D: chk3d ? chk3d.checked : true,
        include2D: chk2d ? chk2d.checked : true,
        includeScript: chkScript ? chkScript.checked : true
      });
      const created = await saveCloudModel(payload);
      if (nameInput) nameInput.value = '';
      cachedModels = [created, ...cachedModels];
      renderModels();
      setStatus(`Đã lưu "${created.name}" lên Thư viện chung! Người khác mở app có thể dùng ngay.`, 'success');
    } catch (err) {
      setStatus(err.message || 'Lưu lên thư viện thất bại.', 'error');
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = prevText;
    }
  });

  btnAdminToggle?.addEventListener('click', () => {
    if (!adminBar) return;
    const isHidden = adminBar.style.display === 'none';
    adminBar.style.display = isHidden ? 'flex' : 'none';
    syncAdminUI();
    if (isHidden && !isAdminActive) adminPinInput?.focus();
  });

  async function handleAdminLogin() {
    const pin = (adminPinInput?.value || '').trim();
    if (!pin) {
      setStatus('Vui lòng nhập mã PIN Admin.', 'error');
      return;
    }
    btnAdminLogin.disabled = true;
    try {
      await verifyAdminPin(pin);
      setStoredAdminPin(pin);
      isAdminActive = true;
      if (adminPinInput) adminPinInput.value = '';
      syncAdminUI();
      renderModels();
      setStatus('Đã bật chế độ Admin. Bạn có thể bấm 🗑️ để xóa các bài không hợp lệ.', 'success');
    } catch (err) {
      setStatus(err.message || 'Xác thực Admin thất bại.', 'error');
    } finally {
      btnAdminLogin.disabled = false;
    }
  }

  btnAdminLogin?.addEventListener('click', handleAdminLogin);
  adminPinInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdminLogin();
    }
  });

  btnAdminLogout?.addEventListener('click', () => {
    setStoredAdminPin('');
    isAdminActive = false;
    syncAdminUI();
    renderModels();
    if (adminBar) adminBar.style.display = 'none';
    setStatus('Đã thoát chế độ Admin.', 'info');
  });
}
