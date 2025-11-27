const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();

// Global CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());

// ---------- CONFIG ----------
const projectRoot = process.env.NODE_ENV === 'production' 
  ? __dirname 
  : path.resolve(__dirname, '..');
  
const outputDir = path.join(projectRoot, 'output');
const vinaPath = path.join(projectRoot, 'tools', process.platform === 'win32' ? 'vina.exe' : 'vina');
const configPath = path.join(projectRoot, 'config.txt');

// Create output folder
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Static file serving with CORS
app.use('/output', express.static(outputDir, {
  setHeaders: (res, filepath) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
  }
}));

// ---------- HEALTH CHECK ----------
app.get('/health', (req, res) => {
  const vinaExists = fs.existsSync(vinaPath);
  const configExists = fs.existsSync(configPath);
  let vinaExecutable = false;
  
  if (vinaExists) {
    try {
      fs.accessSync(vinaPath, fs.constants.X_OK);
      vinaExecutable = true;
    } catch (e) {
      vinaExecutable = false;
    }
  }
  
  res.json({ 
    status: 'ok', 
    vinaExists,
    vinaExecutable,
    configExists,
    outputDir,
    platform: process.platform
  });
});

// ---------- 3D VIEWER ----------
app.get('/viewer/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  
  if (!filename.endsWith('.pdbqt')) {
    return res.status(400).send('Invalid file type');
  }

  const filePath = path.join(outputDir, filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html><head><title>File Not Found</title></head>
      <body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #667eea;">
        <div style="background: white; padding: 40px; border-radius: 16px; text-align: center;">
          <h1 style="color: #fc8181;">⚠️ File Not Found</h1>
          <p>The file <strong>${filename}</strong> does not exist.</p>
        </div>
      </body></html>
    `);
  }

  // FIXED: Force HTTPS for Render deployment
  const protocol = req.get('x-forwarded-proto') === 'https' ? 'https' : req.protocol;
  const host = req.get('host');
  const pdbqtUrl = `${protocol}://${host}/output/${filename}`;
  
  console.log('🔬 3D Viewer:', filename);
  console.log('   Protocol:', protocol);
  console.log('   Host:', host);
  console.log('   Full URL:', pdbqtUrl);

  const viewerHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>3D Structure Viewer - ${filename}</title>
  <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
  <script src="https://3Dmol.csb.pitt.edu/build/3Dmol-min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      height: 100vh; 
      display: flex; 
      flex-direction: column;
    }
    .header { 
      background: rgba(255,255,255,0.95); 
      padding: 16px 24px; 
      display: flex; 
      justify-content: space-between; 
      align-items: center;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    .header h1 { font-size: 20px; color: #2d3748; }
    .controls { display: flex; gap: 8px; }
    .btn { 
      padding: 10px 18px; 
      border: none; 
      border-radius: 8px; 
      cursor: pointer; 
      font-weight: 600;
      transition: all 0.2s;
    }
    .btn-primary { background: #667eea; color: white; }
    .btn-primary:hover { background: #5568d3; }
    .btn-secondary { background: white; color: #4a5568; border: 2px solid #e2e8f0; }
    #viewport-container { 
      flex: 1; 
      display: flex; 
      justify-content: center; 
      align-items: center; 
      padding: 20px;
      position: relative;
    }
    #viewport { 
      width: 100%; 
      height: 100%; 
      max-width: 1200px; 
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      background: white;
    }
    .loading { 
      position: absolute; 
      top: 50%; 
      left: 50%; 
      transform: translate(-50%, -50%);
      text-align: center;
      color: white;
      z-index: 10;
    }
    .spinner { 
      border: 4px solid rgba(255,255,255,0.3); 
      border-top: 4px solid white; 
      border-radius: 50%;
      width: 50px; 
      height: 50px; 
      animation: spin 1s linear infinite; 
      margin: 0 auto 16px;
    }
    @keyframes spin { 
      0% { transform: rotate(0deg); } 
      100% { transform: rotate(360deg); } 
    }
    .error { 
      background: white; 
      padding: 30px; 
      border-radius: 12px; 
      max-width: 500px;
      color: #e53e3e;
    }
    .info { 
      position: absolute; 
      bottom: 20px; 
      left: 20px; 
      background: rgba(255,255,255,0.95);
      padding: 16px; 
      border-radius: 12px;
      min-width: 200px;
      display: none;
    }
    .info h3 { font-size: 14px; color: #4a5568; margin-bottom: 8px; }
    .info-item { padding: 4px 0; font-size: 13px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🧬 ${filename}</h1>
    <div class="controls">
      <button class="btn btn-secondary" onclick="zoomIn()">🔍+</button>
      <button class="btn btn-secondary" onclick="zoomOut()">🔍-</button>
      <button class="btn btn-secondary" onclick="resetView()">🔄</button>
      <button class="btn btn-primary" onclick="changeStyle()">🎨 Style</button>
    </div>
  </div>

  <div id="viewport-container">
    <div class="loading" id="loading">
      <div class="spinner"></div>
      <div>Loading 3D Structure...</div>
    </div>
    <div id="viewport"></div>
    <div class="info" id="info">
      <h3>Structure Info</h3>
      <div class="info-item">Style: <span id="style-name">Stick</span></div>
      <div class="info-item">Atoms: <span id="atom-count">—</span></div>
    </div>
  </div>

  <script>
    let viewer, currentStyle = 0;
    const styles = [
      { name: 'Stick', config: {stick: {radius: 0.2}} },
      { name: 'Cartoon', config: {cartoon: {}} },
      { name: 'Sphere', config: {sphere: {scale: 0.3}} },
      { name: 'Line', config: {line: {}} }
    ];

    function initViewer() {
      console.log('🚀 Initializing viewer...');
      viewer = $3Dmol.createViewer($('#viewport'), {
        backgroundColor: 'white'
      });

      $.ajax({
        url: '${pdbqtUrl}',
        type: 'GET',
        dataType: 'text',
        crossDomain: true,
        xhrFields: { withCredentials: false },
        success: function(data) {
          console.log('✅ Data loaded:', data.length, 'bytes');
          
          try {
            viewer.addModel(data, 'pdbqt');
            viewer.setStyle({}, styles[0].config);
            viewer.zoomTo();
            viewer.render();
            
            const atoms = viewer.getModel().selectedAtoms({});
            console.log('✅ Rendered! Atoms:', atoms.length);
            
            $('#loading').hide();
            $('#info').show();
            $('#atom-count').text(atoms.length);
          } catch (e) {
            console.error('❌ Render error:', e);
            showError('Failed to render: ' + e.message);
          }
        },
        error: function(xhr, status, error) {
          console.error('❌ Load error:', status, error);
          showError('Failed to load file: ' + status);
        }
      });
    }

    function showError(msg) {
      $('#loading').html('<div class="error"><h2>Error</h2><p>' + msg + '</p></div>');
    }

    function changeStyle() {
      currentStyle = (currentStyle + 1) % styles.length;
      const style = styles[currentStyle];
      viewer.setStyle({}, style.config);
      viewer.render();
      $('#style-name').text(style.name);
    }

    function zoomIn() { viewer.zoom(1.2); viewer.render(); }
    function zoomOut() { viewer.zoom(0.8); viewer.render(); }
    function resetView() {
      viewer.zoomTo();
      viewer.render();
      currentStyle = 0;
      viewer.setStyle({}, styles[0].config);
      viewer.render();
      $('#style-name').text('Stick');
    }

    $(document).ready(function() {
      console.log('📄 Document ready, starting viewer...');
      setTimeout(initViewer, 100);
    });
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(viewerHTML);
});

// ---------- DOCKING ENDPOINT ----------
app.post('/run-docking', (req, res) => {
  console.log('═══════════════════════════════════════════');
  console.log('🧪 Starting molecular docking...');
  console.log('═══════════════════════════════════════════');

  if (!fs.existsSync(vinaPath)) {
    return res.status(500).json({ error: 'Vina not found', path: vinaPath });
  }

  // Check/fix permissions
  try {
    fs.accessSync(vinaPath, fs.constants.X_OK);
    console.log('✅ Vina is executable');
  } catch (e) {
    try {
      fs.chmodSync(vinaPath, '755');
      console.log('✅ Fixed permissions');
    } catch (err) {
      return res.status(500).json({ error: 'Cannot fix Vina permissions' });
    }
  }

  if (!fs.existsSync(configPath)) {
    return res.status(500).json({ error: 'Config not found', path: configPath });
  }

  const command = `"${vinaPath}" --config "${configPath}"`;
  console.log('Command:', command);

  const startTime = Date.now();

  exec(command, { cwd: projectRoot, timeout: 120000 }, (err, stdout, stderr) => {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    if (err) {
      console.error('❌ Vina failed:', stderr || err.message);
      return res.status(500).json({ 
        error: 'Docking failed', 
        details: stderr || err.message,
        duration: duration + 's'
      });
    }

    console.log('✅ Docking completed in', duration, 's');

    // Save log
    fs.writeFileSync(path.join(outputDir, 'log.txt'), stdout);

    // Parse scores
    let bestScore = 'N/A';
    const scores = [];
    
    for (const line of stdout.split('\n')) {
      if (/^\d+\s+-?\d+\.\d+/.test(line.trim())) {
        const score = line.trim().split(/\s+/)[1];
        scores.push(score);
        if (bestScore === 'N/A') bestScore = score;
      }
    }

    const protocol = req.get('x-forwarded-proto') === 'https' ? 'https' : req.protocol;
    const host = req.get('host');
    const viewerUrl = `${protocol}://${host}/viewer/output_docked.pdbqt`;
    const fileUrl = `${protocol}://${host}/output/output_docked.pdbqt`;

    console.log('📊 Best score:', bestScore, 'kcal/mol');
    console.log('🔗 Viewer:', viewerUrl);
    console.log('📁 File:', fileUrl);

    res.json({
      success: true,
      message: 'Docking completed!',
      score: bestScore + ' kcal/mol',
      bestScore,
      allScores: scores,
      pdbqtUrl: viewerUrl,
      viewerUrl,
      downloadUrl: fileUrl,
      duration: duration + 's'
    });
  });
});

// ---------- ERROR HANDLERS ----------
app.use((req, res) => {
  console.log('❌ 404:', req.path);
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(500).json({ error: 'Server error' });
});

// ---------- START SERVER ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('═══════════════════════════════════════════');
  console.log('🚀 Molecular Docking Server');
  console.log('═══════════════════════════════════════════');
  console.log(`📡 http://localhost:${PORT}`);
  console.log(`💚 http://localhost:${PORT}/health`);
  console.log(`🔬 http://localhost:${PORT}/viewer/output_docked.pdbqt`);
  console.log('═══════════════════════════════════════════');
  console.log(`Platform: ${process.platform}`);
  console.log(`Vina: ${fs.existsSync(vinaPath) ? '✓' : '✗'}`);
  console.log(`Config: ${fs.existsSync(configPath) ? '✓' : '✗'}`);
  console.log('═══════════════════════════════════════════');
  console.log('✅ Ready!');
  console.log('═══════════════════════════════════════════\n');
});

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  process.exit(0);
});