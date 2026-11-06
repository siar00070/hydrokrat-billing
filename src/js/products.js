// Reads a chosen photo and shrinks it to a small JPEG data URI (max 420 px) so it stays light in the database.
function readImageAsDataUri(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the image'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a picture'));
      img.onload = () => {
        const scale = Math.min(1, 420 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Small picker: shows the current picture, lets you choose a new one or remove it. onChange gets the data URI or null.
function buildImagePicker(currentDataUri, onChange) {
  const thumb = el('img', { style: 'max-width:80px;max-height:60px;border:1px solid #d5dce6;border-radius:3px;display:none;object-fit:contain;background:#fff' });
  const fileInput = el('input', { type: 'file', accept: 'image/*', style: 'font-size:11px' });
  const removeBtn = el('span', { class: 'btn small secondary', style: 'display:none' }, ['Remove']);
  const show = (uri) => {
    thumb.style.display = uri ? 'block' : 'none';
    removeBtn.style.display = uri ? 'inline-block' : 'none';
    if (uri) thumb.src = uri;
  };
  show(currentDataUri);
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    try {
      const uri = await readImageAsDataUri(f);
      show(uri); onChange(uri);
    } catch (err) { showToast(err.message); }
    fileInput.value = '';
  });
  removeBtn.addEventListener('click', () => { show(null); onChange(null); });
  const libSelect = el('select', { style: 'font-size:11px;max-width:210px' }, [
    el('option', { value: '' }, ['Choose from KSB catalogue...']),
    ...(typeof PUMP_LIBRARY !== 'undefined' ? PUMP_LIBRARY : []).map((p, i) => el('option', { value: String(i) }, [p.name]))
  ]);
  libSelect.addEventListener('change', () => {
    if (libSelect.value === '') return;
    const uri = PUMP_LIBRARY[parseInt(libSelect.value, 10)].data;
    show(uri); onChange(uri); libSelect.value = '';
  });
  return el('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap' }, [thumb, libSelect, fileInput, removeBtn]);
}

async function renderProducts(root) {
  root.appendChild(el('h1', { class: 'page-title' }, ['Products / Items']));

  const searchRow = el('div', { class: 'search-row' });
  const searchInput = el('input', { placeholder: 'Search by description or HSN/SAC...' });
  searchRow.appendChild(searchInput);
  searchRow.appendChild(el('button', { class: 'btn', onclick: () => openProductModal(null, load) }, ['+ Add Product']));
  root.appendChild(searchRow);

  const card = el('div', { class: 'card' });
  root.appendChild(card);

  async function load() {
    card.innerHTML = '';
    const list = await window.api.products.list(searchInput.value.trim());
    if (list.length === 0) {
      card.appendChild(el('div', { class: 'empty-state' }, ['No products found.']));
      return;
    }
    const table = el('table', { class: 'data-table' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', {}, ['Description']), el('th', {}, ['HSN/SAC']), el('th', {}, ['Unit']),
        el('th', {}, ['Rate']), el('th', {}, ['GST %']), el('th', {}, [''])
      ])])
    ]);
    const tbody = el('tbody');
    list.forEach(p => {
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [p.description]),
        el('td', {}, [p.hsn_sac || '-']),
        el('td', {}, [p.unit || '-']),
        el('td', {}, [fmtMoney(p.default_rate)]),
        el('td', {}, [p.gst_percent + '%']),
        el('td', {}, [
          el('div', { class: 'btn-row' }, [
            el('span', { class: 'btn small secondary', onclick: () => openProductModal(p, load) }, ['Edit']),
            el('span', { class: 'btn small danger', onclick: async () => {
              if (confirmDialog(`Delete product "${p.description}"?`)) {
                await window.api.products.delete(p.id);
                showToast('Product deleted');
                load();
              }
            } }, ['Delete'])
          ])
        ])
      ]));
    });
    table.appendChild(tbody);
    card.appendChild(table);
  }

  searchInput.addEventListener('input', debounce(load, 250));
  load();
}

function openProductModal(product, onSaved) {
  const isEdit = !!product;
  const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });

  const descInput = el('input', { value: product ? product.description : '' });
  const hsnInput = el('input', { value: product ? product.hsn_sac || '' : '' });
  const unitInput = el('input', { value: product ? product.unit || 'Nos' : 'Nos' });
  const rateInput = el('input', { type: 'number', step: '0.01', value: product ? product.default_rate : 0 });
  const gstInput = el('input', { type: 'number', step: '0.01', value: product ? product.gst_percent : 18 });
  let imageData = product ? (product.image_data || null) : null;
  const imagePicker = buildImagePicker(imageData, (uri) => { imageData = uri; });

  const box = el('div', { class: 'modal-box' }, [
    el('h3', {}, [isEdit ? 'Edit Product' : 'Add Product']),
    el('div', { class: 'field' }, [el('label', {}, ['Description']), descInput]),
    el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [el('label', {}, ['HSN/SAC']), hsnInput]),
      el('div', { class: 'field' }, [el('label', {}, ['Unit']), unitInput])
    ]),
    el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [el('label', {}, ['Default Rate (₹)']), rateInput]),
      el('div', { class: 'field' }, [el('label', {}, ['GST %']), gstInput])
    ]),
    el('div', { class: 'field' }, [el('label', {}, ['Pump image (shown on Quotation / Proforma / Techno Commercial Offer)']), imagePicker]),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn', onclick: async () => {
        const payload = {
          description: descInput.value.trim(), hsn_sac: hsnInput.value.trim(),
          unit: unitInput.value.trim() || 'Nos',
          default_rate: parseFloat(rateInput.value) || 0,
          gst_percent: parseFloat(gstInput.value) || 0,
          image_data: imageData
        };
        if (!payload.description) { showToast('Description is required'); return; }
        if (isEdit) await window.api.products.update(product.id, payload);
        else await window.api.products.create(payload);
        overlay.remove();
        showToast('Product saved');
        if (onSaved) onSaved();
      } }, ['Save']),
      el('button', { class: 'btn secondary', onclick: () => overlay.remove() }, ['Cancel'])
    ])
  ]);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  descInput.focus();
}
