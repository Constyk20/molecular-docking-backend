// C:\docking_project\backend\server.js
const express = require('express');
const { exec } = require('child_process');
const fs   = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ---------- CONFIG ----------
const projectRoot = path.resolve(__dirname, '..');           // C:/docking_project
const outputDir   = path.join(projectRoot, 'output');
const vinaPath    = path.join(projectRoot, 'tools', process.platform === 'win32' ? 'vina.exe' : 'vina');
const configPath  = path.join(projectRoot, 'config.txt');

// ---------- SERVE OUTPUT ----------
app.use('/output', express.static(outputDir, {
  setHeaders: (res, filepath) => {
    if (filepath.endsWith('.pdbqt')) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    }
  }
}));

// Create output folder
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// ---------- 3D VIEWER ----------
app.get('/viewer/:filename', (req, res) => {
  const filename = path.basename(req.params.filename); // Prevent directory traversal
  if (!filename.endsWith('.pdbqt')) {
    return res.status(400).send('Invalid file');
  }

  const filePath = path.join(outputDir, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File not found');
  }

  // Dynamic base URL (localhost or Render domain)
  const protocol = req.protocol;
  const host = req.get('host');
  const baseUrl = `${protocol}://${host}`;
  const pdbqtUrl = `${baseUrl}/output/${filename}?t=${Date.now()}`;

  const viewerHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>3D Molecular Structure Viewer</title>
  <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
  <script src="https://3Dmol.csb.pitt.edu/build/3Dmol-min.js"></script>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
           background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
           height:100vh; display:flex; flex-direction:column; overflow:hidden; }
    .header { background:rgba(255,255,255,0.95); padding:16px 24px; box-shadow:0 2px 10px rgba(0,0,0,0.1);
              display:flex; justify-content:space-between; align-items:center; backdrop-filter:blur(10px); }
    .header h1 { font-size:20px; color:#2d3748; display:flex; align-items:center; gap:10px; }
    .header h1::before { content:'DNA'; font-size:24px; }
    .controls { display:flex; gap:8px; flex-wrap:wrap; }
    .btn { padding:8px 16px; border:none; border-radius:8px; cursor:pointer; font-size:14px;
           font-weight:600; transition:all 0.2s; display:flex; align-items:center; gap:6px; }
    .btn-primary { background:#667eea; color:white; }
    .btn-primary:hover { background:#5568d3; transform:translateY(-1px); box-shadow:0 4px 12px rgba(102,126,234,0.4); }
    .btn-secondary { background:white; color:#4a5568; border:2px solid #e2e8f0; }
    .btn-secondary:hover { background:#f7fafc; border-color:#cbd5e0; }
    #viewport-container { flex:1; display:flex; justify-content:center; align-items:center; padding:20px; position:relative; }
    #viewport { width:100%; height:100%; max-width:1200px; border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,0.3);
                background:white; position:relative; }
    .loading { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); text-align:center;
               color:white; font-size:18px; z-index:10; }
    .spinner { border:4px solid rgba(255,255,255,0.3); border-top:4px solid white; border-radius:50%;
               width:50px; height:50px; animation:spin 1s linear infinite; margin:0 auto 16px; }
    @keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }
    .info-panel { position:absolute; bottom:20px; left:20px; background:rgba(255,255,255,0.95);
                  padding:16px; border-radius:12px; box-shadow:0 4px 20px rgba(0,0,0,0.15);
                  min-width:200px; backdrop-filter:blur(10px); display:none; }
    .info-panel h3 { font-size:14px; color:#4a5568; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px; }
    .info-item { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #e2e8f0; }
    .info-item:last-child { border-bottom:none; }
    .info-label { font-size:13px; color:#718096; }
    .info-value { font-size:13px; font-weight:600; color:#2d3748; }
    .error { color:#fc8181; background:rgba(255,255,255,0.9); padding:20px; border-radius:12px; max-width:500px; }
    @media (max-width:768px) {
      .header { flex-direction:column; gap:12px; align-items:stretch; }
      .controls { justify-content:center; }
      .info-panel { left:10px; right:10px; bottom:10px; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Molecular Docking Result</h1>
    <div class="controls">
      <button class="btn btn-secondary" onclick="zoomIn()">Zoom In</button>
      <button class="btn btn-secondary" onclick="zoomOut()">Zoom Out</button>
      <button class="btn btn-secondary" onclick="resetView()">Reset</button>
      <button class="btn btn-primary" onclick="changeStyle()">Style</button>
    </div>
  </div>

  <div id="viewport-container">
    <div class="loading" id="loading">
      <div class="spinner"></div>
      <div>Loading 3D Structure...</div>
    </div>
    <div id="viewport"></div>
    <div class="info-panel" id="info-panel">
      <h3>Structure Info</h3>
      <div class="info-item"><span class="info-label">Format:</span><span class="info-value">PDBQT</span></div>
      <div class="info-item"><span class="info-label">Viewer:</span><span class="info-value">3Dmol.js</span></div>
      <div class="info-item"><span class="info-label">Style:</span><span class="info-value" id="current-style">Stick</span></div>
    </div>
  </div>

  <script>
    let viewer, currentStyle = 0;
    const styles = [
      { name: 'Stick',   style: 'stick',   colorscheme: 'default' },
      { name: 'Cartoon', style: 'cartoon', colorscheme: 'spectrum' },
      { name: 'Sphere',  style: 'sphere',  colorscheme: 'element' },
      { name: 'Line',    style: 'line',    colorscheme: 'default' }
    ];

    function initViewer() {
      const element = $('#viewport');
      viewer = $3Dmol.createViewer(element, { backgroundColor: 'white', antialias: true });

      const url = "${pdbqtUrl}";
      $.get(url, function(data) {
        try {
          viewer.addModel(data, 'pdbqt');
          viewer.setStyle({}, { stick: { colorscheme: 'default' } });
          viewer.zoomTo();
          viewer.render();
          $('#loading').fadeOut();
          $('#info-panel').fadeIn();
        } catch (e) {
          showError('Render error: ' + e.message);
        }
      }).fail(function() {
        showError('Failed to load file');
      });
    }

    function showError(msg) {
      $('#loading').html('<div class="error">Error: ' + msg + '</div>');
    }

    function changeStyle() {
      currentStyle = (currentStyle + 1) % styles.length;
      const s = styles[currentStyle];
      viewer.setStyle({}, { [s.style]: { colorscheme: s.colorscheme } });
      viewer.render();
      $('#current-style').text(s.name);
    }

    function zoomIn()  { viewer.zoom(1.2); viewer.render(); }
    function zoomOut() { viewer.zoom(0.8); viewer.render(); }
    function resetView(){ viewer.zoomTo(); viewer.render(); }

    $(document).ready(initViewer);
  </script>
</body>
</html>
  `;

  res.send(viewerHTML);
});

// ---------- DOCKING ENDPOINT ----------
app.post('/run-docking', (req, res) => {
  console.log('Starting docking...');

  const command = process.platform === 'win32'
    ? `"${vinaPath}" --config "${configPath}"`
    : `${vinaPath} --config "${configPath}"`;

  exec(command, { cwd: projectRoot }, (err, stdout, stderr) => {
    if (err) {
      console.error('Vina error:', stderr);
      return res.status(500).json({ error: 'Docking failed', details: stderr });
    }

    console.log('Docking finished!');

    const logPath = path.join(outputDir, 'log.txt');
    if (!fs.existsSync(logPath)) {
      return res.status(500).json({ error: 'Log file missing' });
    }

    fs.readFile(logPath, 'utf8', (readErr, data) => {
      if (readErr) return res.status(500).json({ error: 'Cannot read log' });

      let bestScore = 'Not found';
      for (const line of data.split('\n')) {
        const trimmed = line.trim();
        if (/^\d+\s+-?\d+\.\d+/.test(trimmed)) {
          bestScore = trimmed.split(/\s+/)[1];
          break;
        }
      }

      const protocol = req.protocol;
      const host = req.get('host');
      const viewerUrl = `${protocol}://${host}/viewer/output_docked.pdbqt?t=${Date.now()}`;

      res.json({
        message: 'Docking successful!',
        score: bestScore + ' kcal/mol',
        viewerUrl: viewerUrl,
        pdbqtUrl: `${protocol}://${host}/output/output_docked.pdbqt?t=${Date.now()}`
      });
    });
  });
});

// ---------- START SERVER ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend → http://localhost:${PORT}`);
  console.log(`Viewer  → http://localhost:${PORT}/viewer/output_docked.pdbqt`);
});