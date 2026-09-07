async function renderDocumentsList(root) {
  root.appendChild(el('h1', { class: 'page-title' }, ['Documents']));

  let showTrash = false;

  const searchRow = el('div', { class: 'search-row' });
  const searchInput = el('input', { placeholder: 'Search by number or customer...' });
  const typeSelect = el('select', {}, [
    el('option', { value: '' }, ['All Types']),
    el('option', { value: 'quotation' }, ['Quotation']),
    el('option', { value: 'proforma' }, ['Proforma Invoice']),
    el('option', { value: 'tax_invoice' }, ['Tax Invoice'])
  ]);
  typeSelect.style.maxWidth = '200px';
  searchRow.appendChild(searchInput);
  searchRow.appendChild(typeSelect);
  const trashBtn = el('button', {
    class: 'btn secondary',
    onclick: () => { showTrash = !showTrash; trashBtn.textContent = showTrash ? '📄 Back to Documents' : '🗑 Trash'; load(); }
  }, ['🗑 Trash']);
  searchRow.appendChild(trashBtn);
  searchRow.appendChild(el('button', {
    class: 'btn secondary',
    onclick: async () => {
      const r = await window.api.exportExcel.documents({ search: searchInput.value.trim(), docType: typeSelect.value });
      if (r.success) showToast('Exported: ' + r.filePath);
    }
  }, ['⬇ Export to Excel']));
  searchRow.appendChild(el('button', { class: 'btn', onclick: () => navigate('document-editor', { docType: 'quotation' }) }, ['+ New Document']));
  root.appendChild(searchRow);

  const card = el('div', { class: 'card' });
  root.appendChild(card);

  async function load() {
    card.innerHTML = '';
    const list = showTrash
      ? await window.api.documents.listDeleted()
      : await window.api.documents.list({ search: searchInput.value.trim(), docType: typeSelect.value });

    if (list.length === 0) {
      card.appendChild(el('div', { class: 'empty-state' }, [showTrash ? 'Trash is empty.' : 'No documents found.']));
      return;
    }
    const headerCells = [
      el('th', {}, ['Type']), el('th', {}, ['Number']), el('th', {}, ['Date']),
      el('th', {}, ['Customer']), el('th', {}, ['Branch']), el('th', {}, ['Total'])
    ];
    if (!showTrash) headerCells.push(el('th', {}, ['Payment']));
    headerCells.push(el('th', {}, ['']));
    const table = el('table', { class: 'data-table' }, [el('thead', {}, [el('tr', {}, headerCells)])]);
    const tbody = el('tbody');
    list.forEach(d => {
      const cells = [
        el('td', {}, [badgeFor(d.doc_type)]),
        el('td', {}, [d.doc_number]),
        el('td', {}, [fmtDate(d.doc_date)]),
        el('td', {}, [d.customer_name || '-']),
        el('td', {}, [d.branch_name || '-']),
        el('td', {}, [fmtMoney(d.total)])
      ];

      if (!showTrash) {
        if (d.doc_type === 'tax_invoice') {
          const overdue = d.payment_status === 'unpaid' && d.due_date && d.due_date < new Date().toISOString().slice(0, 10);
          const label = d.payment_status === 'paid' ? 'Paid' : overdue ? 'Overdue' : 'Unpaid';
          const cls = d.payment_status === 'paid' ? 'paid' : overdue ? 'overdue' : 'unpaid';
          const badgeCell = el('td', {}, [el('span', { class: `payment-badge ${cls}` }, [label])]);
          if (d.payment_status === 'paid') {
            const detailLines = [
              d.payment_date ? `Paid: ${fmtDate(d.payment_date)}` : null,
              d.payment_amount ? `Amt: ${fmtMoney(d.payment_amount)}` : null,
              d.payment_reference ? `Ref: ${d.payment_reference}` : null
            ].filter(Boolean);
            if (detailLines.length > 0) {
              badgeCell.appendChild(el('div', { style: 'font-size:10.5px;color:#6b7280;margin-top:3px;line-height:1.5' },
                detailLines.map(line => el('div', {}, [line]))));
            }
          }
          cells.push(badgeCell);
        } else {
          cells.push(el('td', {}, ['-']));
        }
      }

      const actions = [];
      if (showTrash) {
        actions.push(el('span', { class: 'btn small secondary', onclick: async () => {
          await window.api.documents.restore(d.id);
          showToast('Document restored');
          load();
        } }, ['Restore']));
        actions.push(el('span', { class: 'btn small danger', onclick: async () => {
          if (confirmDialog(`Permanently delete ${d.doc_number}? This cannot be undone.`)) {
            await window.api.documents.purge(d.id);
            showToast('Permanently deleted');
            load();
          }
        } }, ['Delete Permanently']));
      } else {
        actions.push(el('span', { class: 'btn small secondary', onclick: () => navigate('document-editor', { docId: d.id }) }, ['Open']));
        actions.push(el('span', { class: 'btn small secondary', onclick: async (e) => {
          const btn = e.target;
          const original = btn.textContent;
          btn.textContent = 'Saving...';
          try {
            const r = await downloadDocumentPdf(d.id);
            if (r.success) showToast('PDF saved: ' + r.filePath);
          } finally {
            btn.textContent = original;
          }
        } }, ['⬇ Download']));
        if (d.doc_type === 'tax_invoice') {
          if (d.payment_status === 'paid') {
            actions.push(el('span', {
              class: 'btn small secondary',
              title: [d.payment_date ? `Paid on ${fmtDate(d.payment_date)}` : null,
                d.payment_amount ? `Amount: ${fmtMoney(d.payment_amount)}` : null,
                d.payment_reference ? `Ref: ${d.payment_reference}` : null].filter(Boolean).join(' | '),
              onclick: async () => {
                if (confirmDialog(`Mark ${d.doc_number} back as Unpaid? This clears the recorded payment details.`)) {
                  await window.api.documents.setPaymentStatus(d.id, 'unpaid');
                  showToast('Marked as Unpaid');
                  load();
                }
              }
            }, ['Mark Unpaid']));
          } else {
            actions.push(el('span', { class: 'btn small secondary', onclick: () => openMarkPaidModal(d) }, ['Mark Paid']));
          }
        }
        const nextStage = { quotation: 'proforma', proforma: 'tax_invoice' }[d.doc_type];
        const nextStageLabel = { proforma: 'Proforma', tax_invoice: 'Tax Invoice' };
        if (nextStage) {
          actions.push(el('span', { class: 'btn small', onclick: async () => {
            const created = await window.api.documents.duplicateAs(d.id, nextStage);
            showToast(`Created ${created.doc_number}`);
            navigate('document-editor', { docId: created.id });
          } }, [`→ Convert to ${nextStageLabel[nextStage]}`]));
        }
        actions.push(el('span', { class: 'btn small secondary', onclick: () => openDuplicateMenu(d) }, ['Duplicate As...']));
        actions.push(el('span', { class: 'btn small danger', onclick: async () => {
          if (confirmDialog(`Move ${d.doc_number} to Trash?`)) {
            await window.api.documents.delete(d.id);
            showToast('Moved to Trash');
            load();
          }
        } }, ['Delete']));
      }
      cells.push(el('td', {}, [el('div', { class: 'btn-row' }, actions)]));
      tbody.appendChild(el('tr', {}, cells));
    });
    table.appendChild(tbody);
    card.appendChild(table);
  }

  function openMarkPaidModal(doc) {
    const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
    const dateInput = el('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
    const amountInput = el('input', { type: 'number', step: '0.01', value: doc.total });
    const refInput = el('input', { placeholder: 'UTR / cheque no. / reference (optional)' });
    const box = el('div', { class: 'modal-box' }, [
      el('h3', {}, [`Confirm payment for ${doc.doc_number}`]),
      el('div', { class: 'field' }, [el('label', {}, ['Payment Date']), dateInput]),
      el('div', { class: 'field' }, [el('label', {}, ['Amount Received (₹)']), amountInput]),
      el('div', { class: 'field' }, [el('label', {}, ['Reference / UTR No.']), refInput]),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn', onclick: async () => {
          await window.api.documents.setPaymentStatus(doc.id, 'paid', {
            payment_date: dateInput.value || null,
            payment_amount: parseFloat(amountInput.value) || null,
            payment_reference: refInput.value.trim() || null
          });
          overlay.remove();
          showToast('Marked as Paid');
          load();
        } }, ['Confirm Paid']),
        el('button', { class: 'btn secondary', onclick: () => overlay.remove() }, ['Cancel'])
      ])
    ]);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  function openDuplicateMenu(doc) {
    const options = ['quotation', 'proforma', 'tax_invoice'].filter(t => t !== doc.doc_type);
    const labels = { quotation: 'Quotation', proforma: 'Proforma Invoice', tax_invoice: 'Tax Invoice' };
    const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
    const box = el('div', { class: 'modal-box' }, [
      el('h3', {}, [`Duplicate ${doc.doc_number} as...`]),
      el('div', { class: 'btn-row' }, options.map(opt => el('button', {
        class: 'btn secondary',
        onclick: async () => {
          const created = await window.api.documents.duplicateAs(doc.id, opt);
          overlay.remove();
          showToast(`Created ${created.doc_number}`);
          navigate('document-editor', { docId: created.id });
        }
      }, [labels[opt]])))
    ]);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  searchInput.addEventListener('input', debounce(load, 250));
  typeSelect.addEventListener('change', load);
  load();
}
