async function renderSettings(root) {
  root.appendChild(el('h1', { class: 'page-title' }, ['Settings']));
  const settings = await window.api.settings.get();
  const currentBranch = await window.api.branch.get();

  const fields = {};
  function field(labelText, key, opts) {
    opts = opts || {};
    const input = opts.textarea
      ? el('textarea', { rows: opts.rows || 3 }, [settings[key] || ''])
      : el('input', { type: opts.type || 'text', value: settings[key] ?? '' });
    fields[key] = input;
    return el('div', { class: 'field' }, [el('label', {}, [labelText]), input]);
  }

  const scanBtn = el('button', {
    class: 'btn secondary small', style: 'margin-bottom:14px',
    onclick: () => pickAndScanImage(
      (extracted) => {
        if (!fields.name.value.trim() && extracted.name) fields.name.value = extracted.name;
        if (!fields.address_line1.value.trim() && extracted.address) fields.address_line1.value = extracted.address;
        if (!fields.gstin.value.trim() && extracted.gstin) fields.gstin.value = extracted.gstin;
        if (!fields.email.value.trim() && extracted.email) fields.email.value = extracted.email;
        if (!fields.phone1.value.trim() && extracted.mobile) fields.phone1.value = extracted.mobile;
        if (!fields.state.value.trim() && extracted.state) fields.state.value = extracted.state;
        if (!fields.city_state_pincode.value.trim() && (extracted.city || extracted.pincode)) {
          fields.city_state_pincode.value = [extracted.city, extracted.pincode].filter(Boolean).join(' - ');
        }
        scanBtn.textContent = '📷 Scan letterhead / GST certificate to fill';
        scanBtn.disabled = false;
        showToast('Scanned — please double-check the fields below');
      },
      (err) => {
        scanBtn.textContent = '📷 Scan letterhead / GST certificate to fill';
        scanBtn.disabled = false;
        showToast('Scan failed: ' + (err.message || 'could not read image'));
      },
      () => { scanBtn.textContent = 'Scanning...'; scanBtn.disabled = true; },
      (step, total) => { scanBtn.textContent = `Scanning (checking orientation ${step}/${total})...`; }
    )
  }, ['📷 Scan letterhead / GST certificate to fill']);

  const companyCard = el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0;color:#0e3a5f' }, ['Company Details']),
    scanBtn,
    field('Company Name', 'name'),
    field('Address Line 1', 'address_line1'),
    field('Address Line 2', 'address_line2'),
    field('Address Line 3', 'address_line3'),
    field('City, State - Pincode', 'city_state_pincode'),
    el('div', { class: 'field-row' }, [field('Phone 1', 'phone1'), field('Phone 2', 'phone2')]),
    field('Email', 'email'),
    el('div', { class: 'field-row' }, [field('GSTIN', 'gstin'), field('State (for GST place-of-supply logic)', 'state')])
  ]);

  const bankCard = el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0;color:#0e3a5f' }, ['Bank / Payment Details']),
    field('Bank Name', 'bank_name'),
    field('Account Name', 'account_name'),
    field('Account No', 'account_no'),
    field('IFSC', 'ifsc')
  ]);

  const termsCard = el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0;color:#0e3a5f' }, ['Default Terms & Conditions per Document Type']),
    field('Quotation Terms', 'quotation_terms', { textarea: true, rows: 4 }),
    field('Proforma Invoice Terms', 'proforma_terms', { textarea: true, rows: 4 }),
    field('Tax Invoice Terms', 'tax_invoice_terms', { textarea: true, rows: 4 }),
    field('Default Notes', 'default_notes', { textarea: true, rows: 2 }),
    field('Default GST % for new products', 'default_gst_percent', { type: 'number' })
  ]);

  const branchInput = el('input', { value: currentBranch || '', placeholder: 'e.g. Chennai, Coimbatore' });
  const branchCard = el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0;color:#0e3a5f' }, ['This PC']),
    el('p', { style: 'font-size:11.5px;color:#6b7280;margin-top:-6px' }, [
      'Stored only on this computer (not synced) — tags documents created here so you can tell branches apart in the Documents list.'
    ]),
    el('div', { class: 'field', style: 'max-width:280px' }, [el('label', {}, ['Branch Name']), branchInput]),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn secondary', onclick: async () => {
        await window.api.branch.set(branchInput.value.trim());
        showToast('Branch name saved on this PC');
      } }, ['Save Branch Name'])
    ])
  ]);

  root.appendChild(companyCard);
  root.appendChild(bankCard);
  root.appendChild(termsCard);
  root.appendChild(branchCard);

  root.appendChild(el('div', { class: 'btn-row' }, [
    el('button', { class: 'btn', onclick: async () => {
      const payload = {};
      for (const [key, input] of Object.entries(fields)) {
        payload[key] = key === 'default_gst_percent' ? (parseFloat(input.value) || 0) : input.value;
      }
      await window.api.settings.update(payload);
      showToast('Settings saved');
    } }, ['Save Settings'])
  ]));
}
