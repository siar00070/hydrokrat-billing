const DOC_LABEL = {
  quotation: 'QUOTATION',
  proforma: 'PROFORMA INVOICE',
  tax_invoice: 'TAX INVOICE'
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function fmtMoney(n) {
  const num = Number(n) || 0;
  return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function buildDocumentHtml(doc, settings, customer, cssText) {
  const label = DOC_LABEL[doc.doc_type] || 'DOCUMENT';
  const showValidUntil = doc.doc_type !== 'tax_invoice' && doc.valid_until;

  const itemRows = (doc.items || []).map(it => `
    <tr>
      <td>${esc(it.description)}</td>
      <td>${esc(it.hsn_sac)}</td>
      <td class="num">${esc(it.qty)}</td>
      <td class="num">${fmtMoney(it.rate)}</td>
      <td class="num">${esc(it.gst_percent)}%</td>
      <td class="num">${fmtMoney(it.amount)}</td>
    </tr>
  `).join('');

  const gstRows = doc.igst > 0
    ? `<div class="row"><span>IGST</span><span>${fmtMoney(doc.igst)}</span></div>`
    : `<div class="row"><span>CGST</span><span>${fmtMoney(doc.cgst)}</span></div>
       <div class="row"><span>SGST</span><span>${fmtMoney(doc.sgst)}</span></div>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${esc(doc.doc_number)}</title>
<style>${cssText}</style>
</head>
<body>
<div class="doc-page">
  ${typeof HV_LOGO_DATA_URI !== 'undefined' ? `<img src="${HV_LOGO_DATA_URI}" class="doc-watermark" alt="">` : ''}
  <div class="doc-header">
    <div>
      ${typeof HV_LOGO_DATA_URI !== 'undefined' ? `<img src="${HV_LOGO_DATA_URI}" class="seller-logo" alt="${esc(settings.name)}">` : `<p class="seller-name">${esc(settings.name)}</p>`}
      <div class="seller-details">
        ${esc(settings.address_line1)}<br>
        ${esc(settings.address_line2)}<br>
        ${esc(settings.address_line3)}<br>
        ${esc(settings.city_state_pincode)}<br>
        ${esc(settings.phone1)}${settings.phone2 ? ', ' + esc(settings.phone2) : ''}<br>
        ${esc(settings.email)}<br>
        GSTIN: ${esc(settings.gstin)}
      </div>
    </div>
    <div class="doc-title-box">
      <div class="doc-title">${label}</div>
      <div class="doc-number-pill">${esc(doc.doc_number)}</div>
    </div>
  </div>

  <div class="doc-meta-row">
    <div class="bill-to">
      <div class="label">BILL TO</div>
      <div class="cust-name">${esc(customer ? customer.name : '')}</div>
      <div class="cust-details">
        ${esc(customer ? customer.address : '')}<br>
        ${esc(customer ? [customer.city, customer.pincode].filter(Boolean).join(' - ') : '')}${customer && customer.state ? ', ' + esc(customer.state) : ''}<br>
        ${customer && customer.mobile ? 'Mobile No: ' + esc(customer.mobile) + '<br>' : ''}
        ${customer && customer.gstin ? 'GSTIN: ' + esc(customer.gstin) : ''}
      </div>
    </div>
    <div class="meta-fields">
      <div class="meta-item"><span class="label">DATE&nbsp;&nbsp;</span><span class="value">${fmtDate(doc.doc_date)}</span></div>
      ${showValidUntil ? `<div class="meta-item"><span class="label">VALID UNTIL&nbsp;&nbsp;</span><span class="value">${fmtDate(doc.valid_until)}</span></div>` : ''}
      <div class="meta-item"><span class="label">PLACE OF SUPPLY&nbsp;&nbsp;</span><span class="value">${esc(doc.place_of_supply)}</span></div>
    </div>
  </div>

  <table class="items-table">
    <thead>
      <tr>
        <th>Description</th>
        <th>HSN/SAC</th>
        <th class="num">Qty</th>
        <th class="num">Rate</th>
        <th class="num">GST %</th>
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  <div class="doc-bottom">
    <div class="payment-box">
      <div class="title">Payment Details</div>
      Bank: ${esc(settings.bank_name)}<br>
      Account Name: ${esc(settings.account_name)}<br>
      Account No: ${esc(settings.account_no)}<br>
      IFSC: ${esc(settings.ifsc)}
    </div>
    <div class="totals-box">
      <div class="row"><span>Subtotal</span><span>${fmtMoney(doc.subtotal)}</span></div>
      <div class="row"><span>Discount</span><span>${fmtMoney(doc.discount)}</span></div>
      ${gstRows}
      <div class="row"><span>Round off</span><span>${fmtMoney(doc.round_off)}</span></div>
      <div class="row total"><span>Total</span><span>${fmtMoney(doc.total)}</span></div>
    </div>
  </div>

  <div class="doc-footer">
    <div class="terms-col">
      <div class="title">Terms &amp; Conditions</div>
      ${esc(doc.terms).split('\n').map(l => esc(l)).join('<br>')}
    </div>
    <div class="notes-col">
      <div class="title">Notes</div>
      ${esc(doc.notes).split('\n').map(l => esc(l)).join('<br>')}
    </div>
  </div>

  <div class="signature-row">
    <div class="prepared-by">PREPARED BY <strong>${esc(settings.name)}</strong></div>
    <div class="signatory">Authorised Signatory</div>
  </div>
</div>
</body>
</html>`;
}

async function downloadDocumentPdf(docId) {
  const doc = await window.api.documents.get(docId);
  const settings = await window.api.settings.get();
  const customer = doc.customer_snapshot || null;
  const cssText = await fetch('css/document-theme.css').then(r => r.text());
  const html = buildDocumentHtml(doc, settings, customer, cssText);
  return window.api.document.savePdf(html, doc.doc_number);
}

if (typeof module !== 'undefined') module.exports = { buildDocumentHtml, DOC_LABEL, fmtMoney, fmtDate };
