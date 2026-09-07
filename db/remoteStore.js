const PREFIXES = { quotation: 'QT-HV', proforma: 'PI-HV', tax_invoice: 'TI-HV' };

function createRemoteStore(client) {
  async function currentUserId() {
    const { data } = await client.auth.getSession();
    return data.session ? data.session.user.id : null;
  }

  function unwrap({ data, error }) {
    if (error) throw new Error(error.message);
    return data;
  }

  return {
    // ---- Company settings ----
    async getSettings() {
      const data = unwrap(await client.from('company_settings').select('*').eq('id', 1).single());
      return data;
    },
    async updateSettings(fields) {
      const uid = await currentUserId();
      const data = unwrap(await client.from('company_settings')
        .update({ ...fields, updated_at: new Date().toISOString(), updated_by: uid })
        .eq('id', 1)
        .select()
        .single());
      return data;
    },

    // ---- Customers ----
    async listCustomers(search) {
      let q = client.from('customers').select('*').order('name');
      if (search) q = q.or(`name.ilike.%${search}%,gstin.ilike.%${search}%`);
      return unwrap(await q);
    },
    async getCustomer(id) {
      const { data, error } = await client.from('customers').select('*').eq('id', id).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    async createCustomer(c) {
      const uid = await currentUserId();
      return unwrap(await client.from('customers')
        .insert({ ...normalizeCustomer(c), created_by: uid, updated_by: uid })
        .select().single());
    },
    async updateCustomer(id, c) {
      const uid = await currentUserId();
      return unwrap(await client.from('customers')
        .update({ ...normalizeCustomer(c), updated_at: new Date().toISOString(), updated_by: uid })
        .eq('id', id).select().single());
    },
    async deleteCustomer(id) {
      unwrap(await client.from('customers').delete().eq('id', id));
      return true;
    },

    // ---- Products ----
    async listProducts(search) {
      let q = client.from('products').select('*').order('description');
      if (search) q = q.or(`description.ilike.%${search}%,hsn_sac.ilike.%${search}%`);
      return unwrap(await q);
    },
    async createProduct(p) {
      const uid = await currentUserId();
      return unwrap(await client.from('products')
        .insert({ ...normalizeProduct(p), created_by: uid, updated_by: uid })
        .select().single());
    },
    async updateProduct(id, p) {
      const uid = await currentUserId();
      return unwrap(await client.from('products')
        .update({ ...normalizeProduct(p), updated_at: new Date().toISOString(), updated_by: uid })
        .eq('id', id).select().single());
    },
    async deleteProduct(id) {
      unwrap(await client.from('products').delete().eq('id', id));
      return true;
    },

    // ---- Documents ----
    async listDocuments(filters) {
      filters = filters || {};
      let q = client.from('documents').select('*').is('deleted_at', null).order('id', { ascending: false });
      if (filters.docType) q = q.eq('doc_type', filters.docType);
      if (filters.search) q = q.ilike('doc_number', `%${filters.search}%`);
      const rows = unwrap(await q);
      return rows.map(d => ({ ...d, customer_name: d.customer_snapshot ? d.customer_snapshot.name : null }));
    },
    async listDeletedDocuments() {
      const rows = unwrap(await client.from('documents').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }));
      return rows.map(d => ({ ...d, customer_name: d.customer_snapshot ? d.customer_snapshot.name : null }));
    },
    async getDocument(id) {
      const { data: doc, error } = await client.from('documents').select('*').eq('id', id).maybeSingle();
      if (error) throw new Error(error.message);
      if (!doc) return null;
      const items = unwrap(await client.from('document_items').select('*').eq('document_id', id).order('sort_order'));
      return { ...doc, items };
    },
    async peekNextDocNumber(docType, year) {
      const { data } = await client.from('counters').select('last_seq').eq('doc_type', docType).eq('year', year).maybeSingle();
      const seq = (data ? data.last_seq : 0) + 1;
      return formatDocNumber(docType, year, seq);
    },
    async nextDocNumber(docType, year) {
      const { data, error } = await client.rpc('next_doc_number', { p_doc_type: docType, p_year: year });
      if (error) throw new Error(error.message);
      return formatDocNumber(docType, year, data);
    },
    async saveDocument(record, existingId) {
      const uid = await currentUserId();
      const { items, ...docFields } = record;
      let docId = existingId;

      if (existingId) {
        unwrap(await client.from('documents')
          .update({ ...docFields, updated_at: new Date().toISOString(), updated_by: uid })
          .eq('id', existingId));
        unwrap(await client.from('document_items').delete().eq('document_id', existingId));
      } else {
        const created = unwrap(await client.from('documents')
          .insert({ ...docFields, created_by: uid, updated_by: uid })
          .select().single());
        docId = created.id;
      }

      if (items && items.length > 0) {
        const rows = items.map(it => ({ ...it, document_id: docId }));
        unwrap(await client.from('document_items').insert(rows));
      }

      return this.getDocument(docId);
    },
    async deleteDocument(id) {
      const uid = await currentUserId();
      unwrap(await client.from('documents')
        .update({ deleted_at: new Date().toISOString(), updated_by: uid })
        .eq('id', id));
      return true;
    },
    async restoreDocument(id) {
      const uid = await currentUserId();
      unwrap(await client.from('documents')
        .update({ deleted_at: null, updated_by: uid })
        .eq('id', id));
      return true;
    },
    async purgeDocument(id) {
      unwrap(await client.from('documents').delete().eq('id', id));
      return true;
    },
    async setPaymentStatus(id, status, details) {
      const uid = await currentUserId();
      const fields = { payment_status: status, updated_at: new Date().toISOString(), updated_by: uid };
      if (status === 'paid') {
        fields.payment_date = (details && details.payment_date) || new Date().toISOString().slice(0, 10);
        fields.payment_amount = (details && details.payment_amount) || null;
        fields.payment_reference = (details && details.payment_reference) || null;
      } else {
        fields.payment_date = null;
        fields.payment_amount = null;
        fields.payment_reference = null;
      }
      return unwrap(await client.from('documents')
        .update(fields)
        .eq('id', id).select().single());
    },
    async getMonthlySummary() {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      // "Billed" means actual sales — Tax Invoices only, not Quotations/Proforma
      // (those aren't final bills yet).
      const rows = unwrap(await client.from('documents')
        .select('doc_type, subtotal, cgst, sgst, igst, total, customer_snapshot, doc_date, payment_status, due_date')
        .is('deleted_at', null)
        .eq('doc_type', 'tax_invoice')
        .gte('doc_date', monthStart));

      const summary = { subtotal: 0, cgst: 0, sgst: 0, igst: 0, total: 0, count: rows.length };
      const byCustomer = {};
      rows.forEach(r => {
        summary.subtotal += Number(r.subtotal) || 0;
        summary.cgst += Number(r.cgst) || 0;
        summary.sgst += Number(r.sgst) || 0;
        summary.igst += Number(r.igst) || 0;
        summary.total += Number(r.total) || 0;
        const name = r.customer_snapshot ? r.customer_snapshot.name : 'Unknown';
        byCustomer[name] = (byCustomer[name] || 0) + (Number(r.total) || 0);
      });
      const topCustomers = Object.entries(byCustomer)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, total]) => ({ name, total }));

      const today = new Date().toISOString().slice(0, 10);
      const unpaidRows = unwrap(await client.from('documents')
        .select('id, doc_number, total, due_date, customer_snapshot')
        .is('deleted_at', null)
        .eq('doc_type', 'tax_invoice')
        .eq('payment_status', 'unpaid'));
      const outstanding = unpaidRows.map(d => ({
        id: d.id, doc_number: d.doc_number, total: d.total, due_date: d.due_date,
        customer_name: d.customer_snapshot ? d.customer_snapshot.name : null,
        overdue: d.due_date ? d.due_date < today : false
      }));
      const outstandingTotal = outstanding.reduce((s, d) => s + (Number(d.total) || 0), 0);
      const overdueTotal = outstanding.filter(d => d.overdue).reduce((s, d) => s + (Number(d.total) || 0), 0);

      return { ...summary, topCustomers, outstanding, outstandingTotal, overdueTotal };
    }
  };
}

function formatDocNumber(docType, year, seq) {
  return `${PREFIXES[docType]}-${year}-${String(seq).padStart(3, '0')}`;
}

function normalizeCustomer(c) {
  return {
    name: c.name || '', address: c.address || '', city: c.city || '',
    state: c.state || '', pincode: c.pincode || '', mobile: c.mobile || '', gstin: c.gstin || ''
  };
}

function normalizeProduct(p) {
  return {
    description: p.description || '', hsn_sac: p.hsn_sac || '',
    default_rate: Number(p.default_rate) || 0, gst_percent: Number(p.gst_percent) || 0,
    unit: p.unit || 'Nos'
  };
}

module.exports = { createRemoteStore };
