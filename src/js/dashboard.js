async function renderDashboard(root) {
  root.appendChild(el('h1', { class: 'page-title' }, ['Dashboard']));

  const quickCreate = el('div', { class: 'quick-create-grid' }, [
    el('div', { class: 'quick-create-card', onclick: () => navigate('document-editor', { docType: 'quotation' }) }, [
      el('div', { class: 'icon' }, ['📝']),
      el('div', { class: 'title' }, ['New Quotation']),
      el('div', { class: 'sub' }, ['Create a price quotation'])
    ]),
    el('div', { class: 'quick-create-card', onclick: () => navigate('document-editor', { docType: 'proforma' }) }, [
      el('div', { class: 'icon' }, ['📃']),
      el('div', { class: 'title' }, ['New Proforma Invoice']),
      el('div', { class: 'sub' }, ['Advance payment / order confirmation'])
    ]),
    el('div', { class: 'quick-create-card', onclick: () => navigate('document-editor', { docType: 'tax_invoice' }) }, [
      el('div', { class: 'icon' }, ['🧾']),
      el('div', { class: 'title' }, ['New Tax Invoice']),
      el('div', { class: 'sub' }, ['GST tax invoice for sales'])
    ])
  ]);
  root.appendChild(el('div', { class: 'card' }, [quickCreate]));

  const summary = await window.api.documents.monthlySummary();

  const summaryCard = el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0;color:#0e3a5f' }, ['This Month']),
    el('div', { class: 'stat-row' }, [
      el('div', { class: 'stat' }, [el('div', { class: 'stat-value' }, [fmtMoney(summary.total)]), el('div', { class: 'stat-label' }, ['Total Billed'])]),
      el('div', { class: 'stat' }, [el('div', { class: 'stat-value' }, [fmtMoney(summary.cgst + summary.sgst + summary.igst)]), el('div', { class: 'stat-label' }, ['GST Collected'])]),
      el('div', { class: 'stat' }, [el('div', { class: 'stat-value' }, [String(summary.count)]), el('div', { class: 'stat-label' }, ['Tax Invoices'])])
    ]),
    summary.topCustomers.length > 0 ? el('div', { style: 'margin-top:12px' }, [
      el('div', { style: 'font-size:11px;color:#6b7280;font-weight:600;margin-bottom:6px' }, ['TOP CUSTOMERS']),
      ...summary.topCustomers.map(c => el('div', { class: 'mini-row' }, [
        el('span', {}, [c.name]), el('span', {}, [fmtMoney(c.total)])
      ]))
    ]) : null
  ].filter(Boolean));
  root.appendChild(summaryCard);

  if (summary.outstanding.length > 0) {
    const outstandingCard = el('div', { class: 'card' }, [
      el('h3', { style: 'margin-top:0;color:#0e3a5f' }, ['Outstanding Payments']),
      el('div', { class: 'stat-row' }, [
        el('div', { class: 'stat' }, [el('div', { class: 'stat-value' }, [fmtMoney(summary.outstandingTotal)]), el('div', { class: 'stat-label' }, ['Total Unpaid'])]),
        el('div', { class: 'stat' }, [el('div', { class: 'stat-value', style: summary.overdueTotal > 0 ? 'color:#c0392b' : '' }, [fmtMoney(summary.overdueTotal)]), el('div', { class: 'stat-label' }, ['Overdue'])])
      ])
    ]);
    const table = el('table', { class: 'data-table', style: 'margin-top:10px' }, [
      el('thead', {}, [el('tr', {}, [el('th', {}, ['Number']), el('th', {}, ['Customer']), el('th', {}, ['Due Date']), el('th', {}, ['Amount']), el('th', {}, [''])])])
    ]);
    const tbody = el('tbody');
    summary.outstanding.forEach(d => {
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [d.doc_number]),
        el('td', {}, [d.customer_name || '-']),
        el('td', {}, [d.due_date ? fmtDate(d.due_date) : '-']),
        el('td', {}, [fmtMoney(d.total)]),
        el('td', {}, [
          d.overdue ? el('span', { class: 'payment-badge overdue' }, ['Overdue']) : el('span', { class: 'payment-badge unpaid' }, ['Unpaid']),
          ' ',
          el('span', { class: 'btn small secondary', onclick: () => navigate('document-editor', { docId: d.id }) }, ['Open'])
        ])
      ]));
    });
    table.appendChild(tbody);
    outstandingCard.appendChild(table);
    root.appendChild(outstandingCard);
  }

  const recentCard = el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0;color:#0e3a5f' }, ['Recent Documents'])
  ]);
  root.appendChild(recentCard);

  const docs = await window.api.documents.list({});
  const recent = docs.slice(0, 8);
  if (recent.length === 0) {
    recentCard.appendChild(el('div', { class: 'empty-state' }, ['No documents yet. Create your first one above.']));
    return;
  }

  const table = el('table', { class: 'data-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', {}, ['Type']), el('th', {}, ['Number']), el('th', {}, ['Date']),
        el('th', {}, ['Customer']), el('th', {}, ['Total']), el('th', {}, [''])
      ])
    ])
  ]);
  const tbody = el('tbody');
  recent.forEach(d => {
    tbody.appendChild(el('tr', {}, [
      el('td', {}, [badgeFor(d.doc_type)]),
      el('td', {}, [d.doc_number]),
      el('td', {}, [fmtDate(d.doc_date)]),
      el('td', {}, [d.customer_name || '-']),
      el('td', {}, [fmtMoney(d.total)]),
      el('td', {}, [el('span', {
        class: 'btn small secondary', onclick: () => navigate('document-editor', { docId: d.id })
      }, ['Open'])])
    ]));
  });
  table.appendChild(tbody);
  recentCard.appendChild(table);
}

function badgeFor(docType) {
  const labels = { quotation: 'Quotation', proforma: 'Proforma', tax_invoice: 'Tax Invoice' };
  return el('span', { class: `badge ${docType}` }, [labels[docType] || docType]);
}
