const DOC_TYPE_LABELS = { quotation: 'Quotation', proforma: 'Proforma Invoice', tax_invoice: 'Tax Invoice' };

async function renderDocumentEditor(root, params) {
  const settings = await window.api.settings.get();
  let customers = await window.api.customers.list();
  let products = await window.api.products.list();

  let doc = null;
  let docType = params.docType || 'quotation';
  if (params.docId) {
    doc = await window.api.documents.get(params.docId);
    docType = doc.doc_type;
  }

  const state = {
    docType,
    docId: doc ? doc.id : null,
    docNumber: doc ? doc.doc_number : null,
    docDate: doc ? doc.doc_date : new Date().toISOString().slice(0, 10),
    validUntil: doc ? doc.valid_until : addDays(new Date(), 15),
    customerId: doc ? doc.customer_id : null,
    placeOfSupply: doc ? doc.place_of_supply : '',
    discount: doc ? doc.discount : 0,
    terms: doc ? doc.terms : settings[termsKeyFor(docType)],
    notes: doc ? doc.notes : settings.default_notes,
    dueDate: doc ? doc.due_date : addDays(new Date(), 30),
    paymentStatus: doc ? (doc.payment_status || 'unpaid') : 'unpaid',
    items: doc ? doc.items.map(it => ({ ...it })) : [emptyItem()]
  };

  root.appendChild(el('h1', { class: 'page-title' }, [doc ? `Edit ${DOC_TYPE_LABELS[docType]}` : `New ${DOC_TYPE_LABELS[docType]}`]));

  // ---- Doc type tabs (only for brand-new documents) ----
  if (!doc) {
    const tabRow = el('div', { class: 'btn-row', style: 'margin-bottom:14px' });
    ['quotation', 'proforma', 'tax_invoice'].forEach(t => {
      tabRow.appendChild(el('button', {
        class: `btn ${t === state.docType ? '' : 'secondary'}`,
        onclick: () => {
          state.docType = t;
          state.terms = settings[termsKeyFor(t)];
          root.innerHTML = '';
          renderDocumentEditor(root, { docType: t });
        }
      }, [DOC_TYPE_LABELS[t]]));
    });
    root.appendChild(tabRow);
  }

  const numberPreview = state.docNumber || await window.api.documents.previewNumber(state.docType);

  const card = el('div', { class: 'card' });
  root.appendChild(card);

  card.appendChild(el('div', { style: 'display:flex;justify-content:space-between;margin-bottom:16px' }, [
    el('div', {}, [
      el('div', { style: 'font-size:11px;color:#6b7280;font-weight:600' }, ['DOCUMENT NUMBER']),
      el('div', { style: 'font-size:16px;font-weight:700;color:#0e3a5f' }, [numberPreview])
    ])
  ]));

  // ---- Customer + dates ----
  const customerSelect = el('select', {}, buildCustomerOptions(customers, state.customerId));
  const dateInput = el('input', { type: 'date', value: state.docDate });
  const validUntilInput = el('input', { type: 'date', value: state.validUntil || '' });
  const placeOfSupplySelect = el('select', {}, [
    el('option', { value: '' }, ['Same as customer state']),
    ...INDIAN_STATES.map(s => el('option', { value: s, ...(state.placeOfSupply === s ? { selected: 'selected' } : {}) }, [s]))
  ]);

  const metaRow = el('div', { class: 'field-row' }, [
    el('div', { class: 'field' }, [
      el('label', {}, ['Customer']),
      customerSelect
    ])
  ]);
  metaRow.appendChild(el('div', { style: 'align-self:flex-end;margin-bottom:12px' }, [
    el('button', { class: 'btn secondary small', onclick: () => openCustomerModal(null, async (c) => {
      customers = await window.api.customers.list();
      customerSelect.innerHTML = '';
      buildCustomerOptions(customers, null).forEach(o => customerSelect.appendChild(o));
    }) }, ['+ New'])
  ]));
  card.appendChild(metaRow);

  const dateRow = el('div', { class: 'field-row' }, [
    el('div', { class: 'field' }, [el('label', {}, ['Date']), dateInput])
  ]);
  if (docType !== 'tax_invoice') {
    dateRow.appendChild(el('div', { class: 'field' }, [el('label', {}, ['Valid Until']), validUntilInput]));
  }
  dateRow.appendChild(el('div', { class: 'field' }, [el('label', {}, ['Place of Supply (GST)']), placeOfSupplySelect]));
  card.appendChild(dateRow);

  let dueDateInput, paymentStatusSelect;
  if (docType === 'tax_invoice') {
    dueDateInput = el('input', { type: 'date', value: state.dueDate || '' });
    const isPaid = doc && doc.payment_status === 'paid';
    paymentStatusSelect = el('select', { ...(isPaid ? { disabled: 'disabled' } : {}) }, [
      el('option', { value: 'unpaid', ...(state.paymentStatus === 'unpaid' ? { selected: 'selected' } : {}) }, ['Unpaid']),
      el('option', { value: 'paid', ...(state.paymentStatus === 'paid' ? { selected: 'selected' } : {}) }, ['Paid'])
    ]);
    card.appendChild(el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [el('label', {}, ['Payment Due Date']), dueDateInput]),
      el('div', { class: 'field' }, [el('label', {}, ['Payment Status']), paymentStatusSelect])
    ]));
    if (isPaid) {
      const details = [
        doc.payment_date ? `Paid on ${fmtDate(doc.payment_date)}` : null,
        doc.payment_amount ? `Amount received: ${fmtMoney(doc.payment_amount)}` : null,
        doc.payment_reference ? `Reference: ${doc.payment_reference}` : null
      ].filter(Boolean).join('  •  ');
      card.appendChild(el('div', { style: 'font-size:12px;color:#166534;background:#dcfce7;padding:8px 12px;border-radius:6px;margin:-8px 0 14px 0' }, [
        details || 'Marked as paid.',
        ' — use Mark Unpaid from the Documents list to change this.'
      ]));
    }
  }

  // ---- Items table ----
  const itemsTable = el('table', { class: 'items-editor-table' }, [
    el('thead', {}, [el('tr', {}, [
      el('th', { class: 'col-desc' }, ['Description']), el('th', { class: 'col-hsn' }, ['HSN/SAC']),
      el('th', { class: 'col-qty' }, ['Qty']), el('th', { class: 'col-rate' }, ['Rate']),
      el('th', { class: 'col-gst' }, ['GST %']), el('th', { class: 'col-amt' }, ['Amount']), el('th', { class: 'col-del' }, [''])
    ])])
  ]);
  const itemsBody = el('tbody');
  itemsTable.appendChild(itemsBody);
  card.appendChild(itemsTable);
  card.appendChild(el('button', {
    class: 'btn secondary small', onclick: () => { state.items.push(emptyItem()); renderItems(); }
  }, ['+ Add Item']));

  function renderItems() {
    itemsBody.innerHTML = '';
    state.items.forEach((item, idx) => {
      const productSelect = el('select', {}, [
        el('option', { value: '' }, ['Custom item...']),
        ...products.map(p => el('option', {
          value: p.id, ...(item.product_id == p.id ? { selected: 'selected' } : {})
        }, [p.description]))
      ]);
      productSelect.addEventListener('change', () => {
        const p = products.find(pp => String(pp.id) === productSelect.value);
        if (p) {
          item.product_id = p.id;
          item.description = p.description;
          item.hsn_sac = p.hsn_sac;
          item.rate = p.default_rate;
          item.gst_percent = p.gst_percent;
        } else {
          item.product_id = null;
        }
        renderItems();
      });

      const descInput = el('input', { value: item.description || '', placeholder: 'Item description' });
      descInput.addEventListener('input', () => { item.description = descInput.value; });

      const hsnInput = el('input', { value: item.hsn_sac || '' });
      hsnInput.addEventListener('input', () => { item.hsn_sac = hsnInput.value; });

      const qtyInput = el('input', { type: 'number', step: '1', value: item.qty || 1 });
      qtyInput.addEventListener('input', () => { item.qty = parseFloat(qtyInput.value) || 0; updateTotals(); });

      const rateInput = el('input', { type: 'number', step: '0.01', value: item.rate || 0 });
      rateInput.addEventListener('input', () => { item.rate = parseFloat(rateInput.value) || 0; updateTotals(); });

      const gstInput = el('input', { type: 'number', step: '0.01', value: item.gst_percent ?? settings.default_gst_percent });
      gstInput.addEventListener('input', () => { item.gst_percent = parseFloat(gstInput.value) || 0; updateTotals(); });

      const amount = (item.qty || 0) * (item.rate || 0);

      itemsBody.appendChild(el('tr', {}, [
        el('td', {}, [productSelect, descInput]),
        el('td', {}, [hsnInput]),
        el('td', {}, [qtyInput]),
        el('td', {}, [rateInput]),
        el('td', {}, [gstInput]),
        el('td', { class: 'col-amt' }, [fmtMoney(amount)]),
        el('td', { class: 'col-del' }, [
          el('span', {
            style: 'cursor:pointer;color:#c0392b;font-weight:700',
            onclick: () => { state.items.splice(idx, 1); if (state.items.length === 0) state.items.push(emptyItem()); renderItems(); }
          }, ['✕'])
        ])
      ]));
    });
    updateTotals();
  }

  // ---- Discount + totals ----
  const discountInput = el('input', { type: 'number', step: '0.01', value: state.discount || 0 });
  discountInput.addEventListener('input', updateTotals);

  const totalsPanel = el('div', { class: 'totals-panel' });
  card.appendChild(el('div', { class: 'field', style: 'max-width:220px;margin-top:10px' }, [
    el('label', {}, ['Discount (₹)']), discountInput
  ]));
  card.appendChild(totalsPanel);

  function updateTotals() {
    const items = state.items.filter(it => it.description && it.description.trim());
    let subtotal = 0, taxTotal = 0;
    items.forEach(it => {
      const amt = round2((it.qty || 0) * (it.rate || 0));
      subtotal += amt;
      taxTotal += amt * ((it.gst_percent || 0) / 100);
    });
    subtotal = round2(subtotal);
    const discount = parseFloat(discountInput.value) || 0;
    const taxableAfterDiscount = Math.max(0, subtotal - discount);
    const effectiveTax = subtotal > 0 ? taxTotal * (taxableAfterDiscount / subtotal) : 0;

    const customer = customers.find(c => String(c.id) === customerSelect.value);
    const customerState = placeOfSupplySelect.value || (customer ? customer.state : '');
    const sameState = (settings.state || '').trim().toLowerCase() === (customerState || '').trim().toLowerCase();
    let cgst = 0, sgst = 0, igst = 0;
    if (sameState) { cgst = round2(effectiveTax / 2); sgst = round2(effectiveTax / 2); }
    else igst = round2(effectiveTax);

    const preRound = taxableAfterDiscount + cgst + sgst + igst;
    const roundOff = round2(Math.round(preRound) - preRound);
    const total = round2(preRound + roundOff);

    totalsPanel.innerHTML = '';
    totalsPanel.appendChild(el('div', { class: 'row' }, [el('span', {}, ['Subtotal']), el('span', {}, [fmtMoney(subtotal)])]));
    totalsPanel.appendChild(el('div', { class: 'row' }, [el('span', {}, ['Discount']), el('span', {}, [fmtMoney(discount)])]));
    if (sameState) {
      totalsPanel.appendChild(el('div', { class: 'row' }, [el('span', {}, ['CGST']), el('span', {}, [fmtMoney(cgst)])]));
      totalsPanel.appendChild(el('div', { class: 'row' }, [el('span', {}, ['SGST']), el('span', {}, [fmtMoney(sgst)])]));
    } else {
      totalsPanel.appendChild(el('div', { class: 'row' }, [el('span', {}, ['IGST']), el('span', {}, [fmtMoney(igst)])]));
    }
    totalsPanel.appendChild(el('div', { class: 'row' }, [el('span', {}, ['Round off']), el('span', {}, [fmtMoney(roundOff)])]));
    totalsPanel.appendChild(el('div', { class: 'row total' }, [el('span', {}, ['Total']), el('span', {}, [fmtMoney(total)])]));
  }

  customerSelect.addEventListener('change', updateTotals);
  placeOfSupplySelect.addEventListener('change', updateTotals);
  renderItems();

  // ---- Terms & Notes ----
  const termsInput = el('textarea', { rows: 4 }, [state.terms || '']);
  const notesInput = el('textarea', { rows: 2 }, [state.notes || '']);
  card.appendChild(el('div', { class: 'field-row', style: 'margin-top:14px' }, [
    el('div', { class: 'field' }, [el('label', {}, ['Terms & Conditions']), termsInput]),
    el('div', { class: 'field' }, [el('label', {}, ['Notes']), notesInput])
  ]));

  // ---- Actions ----
  const actionRow = el('div', { class: 'btn-row', style: 'margin-top:16px' });
  actionRow.appendChild(el('button', { class: 'btn secondary', onclick: () => navigate('documents') }, ['Cancel']));
  actionRow.appendChild(el('button', {
    class: 'btn', onclick: async () => {
      const items = state.items.filter(it => it.description && it.description.trim());
      if (items.length === 0) { showToast('Add at least one item'); return; }
      if (!customerSelect.value) { showToast('Please select a customer'); return; }
      const payload = {
        doc_type: state.docType,
        doc_date: dateInput.value,
        valid_until: docType !== 'tax_invoice' ? (validUntilInput.value || null) : null,
        customer_id: parseInt(customerSelect.value, 10),
        place_of_supply: placeOfSupplySelect.value || null,
        discount: parseFloat(discountInput.value) || 0,
        terms: termsInput.value,
        notes: notesInput.value,
        due_date: docType === 'tax_invoice' ? (dueDateInput.value || null) : null,
        payment_status: docType === 'tax_invoice' ? paymentStatusSelect.value : null,
        items
      };
      let saved;
      if (state.docId) saved = await window.api.documents.update(state.docId, payload);
      else saved = await window.api.documents.create(payload);
      showToast(`Saved ${saved.doc_number}`);
      navigate('document-editor', { docId: saved.id, preview: true });
    }
  }, [doc ? 'Save Changes' : 'Save Document']));

  if (doc) {
    actionRow.appendChild(el('button', { class: 'btn secondary', onclick: () => openPreview(doc.id) }, ['Preview / Print']));
  }
  card.appendChild(actionRow);

  if (params.preview && doc) {
    openPreview(doc.id);
  }
}

async function openPreview(docId) {
  const doc = await window.api.documents.get(docId);
  const settings = await window.api.settings.get();
  const customer = doc.customer_snapshot || null;
  const cssText = await fetch('css/document-theme.css').then(r => r.text());
  const html = buildDocumentHtml(doc, settings, customer, cssText);

  const overlay = el('div', { class: 'modal-overlay', style: 'align-items:flex-start;padding:30px 0' });
  const nextStage = { quotation: 'proforma', proforma: 'tax_invoice' }[doc.doc_type];
  const nextStageLabel = { proforma: 'Proforma', tax_invoice: 'Tax Invoice' };
  const toolbar = el('div', { class: 'preview-toolbar' }, [
    el('button', { class: 'btn secondary', onclick: () => overlay.remove() }, ['Close']),
    el('button', { class: 'btn secondary', onclick: async () => { const r = await window.api.document.print(html); if (r.success) showToast('Sent to printer'); } }, ['Print']),
    el('button', { class: 'btn', onclick: async () => {
      const r = await window.api.document.savePdf(html, doc.doc_number);
      if (r.success) showToast('PDF saved: ' + r.filePath);
    } }, ['Save as PDF']),
    nextStage ? el('button', { class: 'btn', onclick: async () => {
      const created = await window.api.documents.duplicateAs(doc.id, nextStage);
      overlay.remove();
      showToast(`Created ${created.doc_number}`);
      navigate('document-editor', { docId: created.id });
    } }, [`→ Convert to ${nextStageLabel[nextStage]}`]) : null
  ].filter(Boolean));
  const iframe = el('iframe');
  const wrap = el('div', { class: 'preview-frame-wrap' }, [iframe]);
  const box = el('div', { style: 'width:100%;max-width:900px' }, [toolbar, wrap]);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  iframe.srcdoc = html;
}

function buildCustomerOptions(customers, selectedId) {
  return [
    el('option', { value: '' }, ['Select a customer']),
    ...customers.map(c => el('option', {
      value: c.id, ...(selectedId && String(selectedId) === String(c.id) ? { selected: 'selected' } : {})
    }, [c.name]))
  ];
}

function emptyItem() {
  return { product_id: null, description: '', hsn_sac: '', qty: 1, rate: 0, gst_percent: 18 };
}

function termsKeyFor(docType) {
  return docType === 'quotation' ? 'quotation_terms' : docType === 'proforma' ? 'proforma_terms' : 'tax_invoice_terms';
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
