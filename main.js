const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { createSupabaseContext } = require('./db/supabaseClient');
const { createRemoteStore } = require('./db/remoteStore');
const { computeTotals } = require('./db/logic');
const { createWorker } = require('tesseract.js');
const { createLocalConfig } = require('./db/localConfig');
const ExcelJS = require('exceljs');

let mainWindow;
let supabaseCtx;
let store;
let localConfig;
let ocrWorkerPromise = null;

function getOcrWorker() {
  if (!ocrWorkerPromise) ocrWorkerPromise = createWorker('eng');
  return ocrWorkerPromise;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(async () => {
  supabaseCtx = createSupabaseContext(app.getPath('userData'), safeStorage);
  store = createRemoteStore(supabaseCtx.client);
  localConfig = createLocalConfig(app.getPath('userData'));
  registerIpc();
  await supabaseCtx.restoreSession();
  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', async () => {
  if (ocrWorkerPromise) {
    const worker = await ocrWorkerPromise;
    await worker.terminate();
  }
});

function registerIpc() {
  // ---- OCR (scan photo/file to fill fields) ----
  ipcMain.handle('ocr:scan', async (e, dataUrl) => {
    const worker = await getOcrWorker();
    const { data } = await worker.recognize(dataUrl);
    return { text: data.text, confidence: data.confidence };
  });

  // ---- Auth ----
  ipcMain.handle('auth:login', async (e, email, password, remember) => {
    const session = await supabaseCtx.login(email, password, remember);
    return { email: session.user.email };
  });
  ipcMain.handle('auth:logout', async () => {
    await supabaseCtx.logout();
    return true;
  });
  ipcMain.handle('auth:get_session', async () => {
    const user = await supabaseCtx.getCurrentUser();
    return user ? { email: user.email } : null;
  });

  // Company settings
  ipcMain.handle('settings:get', () => store.getSettings());
  ipcMain.handle('settings:update', (e, fields) => store.updateSettings(fields));

  // Customers
  ipcMain.handle('customers:list', (e, search) => store.listCustomers(search));
  ipcMain.handle('customers:get', (e, id) => store.getCustomer(id));
  ipcMain.handle('customers:create', (e, c) => store.createCustomer(c));
  ipcMain.handle('customers:update', (e, id, c) => store.updateCustomer(id, c));
  ipcMain.handle('customers:delete', (e, id) => store.deleteCustomer(id));

  // Products
  ipcMain.handle('products:list', (e, search) => store.listProducts(search));
  ipcMain.handle('products:create', (e, p) => store.createProduct(p));
  ipcMain.handle('products:update', (e, id, p) => store.updateProduct(id, p));
  ipcMain.handle('products:delete', (e, id) => store.deleteProduct(id));

  // Documents
  ipcMain.handle('documents:list', (e, filters) => store.listDocuments(filters));
  ipcMain.handle('documents:get', (e, id) => store.getDocument(id));
  ipcMain.handle('documents:preview_number', (e, docType) => {
    const year = new Date().getFullYear();
    return store.peekNextDocNumber(docType, year);
  });
  ipcMain.handle('documents:create', (e, payload) => saveDocument(payload, null));
  ipcMain.handle('documents:update', (e, id, payload) => saveDocument(payload, id));
  ipcMain.handle('documents:delete', (e, id) => store.deleteDocument(id));
  ipcMain.handle('documents:list_deleted', () => store.listDeletedDocuments());
  ipcMain.handle('documents:restore', (e, id) => store.restoreDocument(id));
  ipcMain.handle('documents:purge', (e, id) => store.purgeDocument(id));
  ipcMain.handle('documents:set_payment_status', (e, id, status, details) => store.setPaymentStatus(id, status, details));
  ipcMain.handle('documents:monthly_summary', () => store.getMonthlySummary());
  ipcMain.handle('documents:duplicate_as', async (e, id, newDocType) => {
    const original = await store.getDocument(id);
    if (!original) throw new Error('Document not found');
    const settings = await store.getSettings();
    const termsKey = newDocType === 'quotation' ? 'quotation_terms' : newDocType === 'proforma' ? 'proforma_terms' : 'tax_invoice_terms';
    const payload = {
      doc_type: newDocType,
      doc_date: new Date().toISOString().slice(0, 10),
      valid_until: newDocType === 'tax_invoice' ? null : original.valid_until,
      customer_id: original.customer_id,
      place_of_supply: original.place_of_supply,
      discount: original.discount,
      terms: settings[termsKey],
      notes: original.notes,
      items: (original.items || []).map(it => ({
        product_id: it.product_id, description: it.description, hsn_sac: it.hsn_sac,
        qty: it.qty, rate: it.rate, gst_percent: it.gst_percent
      }))
    };
    return saveDocument(payload, null);
  });

  // PDF export / print
  ipcMain.handle('document:save_pdf', async (e, html, suggestedName) => {
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save as PDF',
      defaultPath: `${suggestedName || 'document'}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (canceled || !filePath) return { success: false };

    const printWin = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    await printWin.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(html));
    const pdfBuffer = await printWin.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'none' }
    });
    fs.writeFileSync(filePath, pdfBuffer);
    printWin.destroy();
    return { success: true, filePath };
  });

  ipcMain.handle('document:print', async (e, html) => {
    const printWin = new BrowserWindow({ show: false });
    await printWin.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(html));
    return new Promise((resolve) => {
      printWin.webContents.print({ printBackground: true }, (success) => {
        printWin.destroy();
        resolve({ success });
      });
    });
  });

  // ---- This PC's branch name (local only, not synced) ----
  ipcMain.handle('branch:get', () => localConfig.getBranchName());
  ipcMain.handle('branch:set', (e, name) => localConfig.setBranchName(name));

  // ---- Excel export ----
  ipcMain.handle('export:documents_excel', async (e, filters) => {
    const rows = await store.listDocuments(filters || {});
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Documents to Excel',
      defaultPath: 'HV-Documents.xlsx',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });
    if (canceled || !filePath) return { success: false };

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Documents');
    ws.columns = [
      { header: 'Type', key: 'doc_type', width: 14 },
      { header: 'Number', key: 'doc_number', width: 18 },
      { header: 'Date', key: 'doc_date', width: 14 },
      { header: 'Customer', key: 'customer_name', width: 28 },
      { header: 'Branch', key: 'branch_name', width: 14 },
      { header: 'Subtotal', key: 'subtotal', width: 14 },
      { header: 'CGST', key: 'cgst', width: 12 },
      { header: 'SGST', key: 'sgst', width: 12 },
      { header: 'IGST', key: 'igst', width: 12 },
      { header: 'Total', key: 'total', width: 14 },
      { header: 'Payment Status', key: 'payment_status', width: 16 },
      { header: 'Due Date', key: 'due_date', width: 14 }
    ];
    ws.getRow(1).font = { bold: true };
    rows.forEach(r => ws.addRow(r));
    await wb.xlsx.writeFile(filePath);
    return { success: true, filePath };
  });

  ipcMain.handle('export:customers_excel', async () => {
    const rows = await store.listCustomers();
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Customers to Excel',
      defaultPath: 'HV-Customers.xlsx',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });
    if (canceled || !filePath) return { success: false };

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Customers');
    ws.columns = [
      { header: 'Name', key: 'name', width: 28 },
      { header: 'Address', key: 'address', width: 32 },
      { header: 'City', key: 'city', width: 16 },
      { header: 'State', key: 'state', width: 16 },
      { header: 'Pincode', key: 'pincode', width: 12 },
      { header: 'Mobile', key: 'mobile', width: 16 },
      { header: 'GSTIN', key: 'gstin', width: 18 }
    ];
    ws.getRow(1).font = { bold: true };
    rows.forEach(r => ws.addRow(r));
    await wb.xlsx.writeFile(filePath);
    return { success: true, filePath };
  });
}

function setupAutoUpdater() {
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;

  function pushStatus(status, extra) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:update_status', { status, ...extra });
    }
  }

  autoUpdater.on('update-available', (info) => pushStatus('available', { version: info.version }));
  autoUpdater.on('download-progress', (p) => pushStatus('downloading', { percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', () => pushStatus('ready'));
  autoUpdater.on('error', (err) => pushStatus('error', { message: err.message }));

  ipcMain.handle('app:install_update', () => autoUpdater.quitAndInstall());
  ipcMain.handle('app:get_version', () => app.getVersion());

  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch((err) => pushStatus('error', { message: err.message }));
  }
}

async function saveDocument(payload, existingId) {
  const settings = await store.getSettings();
  const customer = payload.customer_id ? await store.getCustomer(payload.customer_id) : null;
  const customerState = payload.place_of_supply || (customer ? customer.state : '');

  const items = payload.items.map((it, idx) => ({
    product_id: it.product_id || null,
    description: it.description,
    hsn_sac: it.hsn_sac || '',
    qty: Number(it.qty) || 0,
    rate: Number(it.rate) || 0,
    gst_percent: Number(it.gst_percent) || 0,
    amount: Math.round((Number(it.qty) * Number(it.rate) + Number.EPSILON) * 100) / 100,
    sort_order: idx
  }));

  const totals = computeTotals({
    items,
    discount: Number(payload.discount) || 0,
    sellerState: settings.state,
    customerState
  });

  const record = {
    doc_type: payload.doc_type,
    doc_date: payload.doc_date,
    valid_until: payload.valid_until || null,
    customer_id: payload.customer_id || null,
    customer_snapshot: customer || null,
    place_of_supply: customerState,
    subtotal: totals.subtotal,
    discount: totals.discount,
    cgst: totals.cgst,
    sgst: totals.sgst,
    igst: totals.igst,
    round_off: totals.roundOff,
    total: totals.total,
    terms: payload.terms || '',
    notes: payload.notes || '',
    due_date: payload.due_date || null,
    payment_status: payload.payment_status || null,
    items
  };

  if (!existingId) {
    const year = new Date(payload.doc_date).getFullYear() || new Date().getFullYear();
    record.doc_number = await store.nextDocNumber(payload.doc_type, year);
    record.branch_name = localConfig.getBranchName() || null;
  }

  return store.saveDocument(record, existingId);
}
