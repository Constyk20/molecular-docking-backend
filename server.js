// C:\docking_project\backend\server.js
const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();

// Enhanced CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());

// ---------- CONFIG ----------
// Use current directory in production, parent directory in development
const projectRoot = process.env.NODE_ENV === 'production' 
  ? __dirname 
  : path.resolve(__dirname, '..');
  
const outputDir = path.join(projectRoot, 'output');

// FIXED: Use 'vina' symlink instead of full filename
const vinaPath = path.join(
  projectRoot, 
  'tools', 
  process.platform === 'win32' ? 'vina.exe' : 'vina'
);

const configPath = path.join(projectRoot, 'config.txt');

// Create output folder
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// CORS headers on static files with proper MIME types
app.use('/output', express.static(outputDir, {
  setHeaders: (res, filepath) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (filepath.endsWith('.pdbqt')) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// ---------- HEALTH CHECK ----------
app.get('/health', (req, res) => {
  const vinaExists = fs.existsSync(vinaPath);
  const configExists = fs.existsSync(configPath);
  
  // Check if Vina is executable
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
    vinaExists: vinaExists,
    vinaExecutable: vinaExecutable,
    vinaPath: vinaPath,
    configExists: configExists,
    configPath: configPath,
    outputDir: outputDir,
    platform: process.platform,
    nodeVersion: process.version,
    projectRoot: projectRoot
  });
});

// ---------- 3D VIEWER ----------
app.get('/viewer/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  
  if (!filename.endsWith('.pdbqt')) {
    return res.status(400).send('Invalid file type. Only .pdbqt files are supported.');
  }

  const filePath = path.join(outputDir, filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>File Not Found</title>
        <style>
          body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; 
                 height: 100vh; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); margin: 0; }
          .error { background: white; padding: 40px; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                   text-align: center; max-width: 500px; }
          h1 { color: #fc8181; margin-bottom: 16px; }
          p { color: #4a5568; line-height: 1.6; }
        </style>
      </head>
      <body>
        <div class="error">
          <h1>⚠️ File Not Found</h1>
          <p>The requested structure file <strong>${filename}</strong> does not exist.</p>
          <p>Please run a docking simulation first.</p>
        </div>
      </body>
      </html>
    `);
  }

  const protocol = req.protocol;
  const host = req.get('host');
  const baseUrl = `${protocol}://${host}`;
  const pdbqtUrl = `${baseUrl}/output/${filename}`;
  
  console.log('═══════════════════════════════════════════');
  console.log('🔬 3D Viewer Request');
  console.log('═══════════════════════════════════════════');
  console.log('Filename:', filename);
  console.log('File Path:', filePath);
  console.log('PDBQT URL:', pdbqtUrl);
  console.log('═══════════════════════════════════════════');

  const viewerHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>3D Molecular Structure Viewer - ${filename}</title>
  
  <script src="https://code.jquery.com/jquery-3.6.0.min.js" 
          integrity="sha256-/xUj+3OJU5yExlq6GSYGSHk7tPXikynS7ogEvDej/m4=" 
          crossorigin="anonymous"></script>
  
  <script src="https://3Dmol.csb.pitt.edu/build/3Dmol-min.js"></script>
  
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      height: 100vh; 
      display: flex; 
      flex-direction: column; 
      overflow: hidden; 
    }
    .header { 
      background: rgba(255,255,255,0.95); 
      padding: 16px 24px; 
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      display: flex; 
      justify-content: space-between; 
      align-items: center; 
      backdrop-filter: blur(10px);
      flex-wrap: wrap;
      gap: 12px;
    }
    .header h1 { 
      font-size: 20px; 
      color: #2d3748; 
      display: flex; 
      align-items: center; 
      gap: 10px; 
    }
    .header h1::before { 
      content: '🧬'; 
      font-size: 24px; 
    }
    .controls { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn { 
      padding: 10px 18px; 
      border: none; 
      border-radius: 8px; 
      cursor: pointer; 
      font-size: 14px;
      font-weight: 600; 
      transition: all 0.2s ease; 
      display: flex; 
      align-items: center; 
      gap: 6px;
    }
    .btn-primary { background: #667eea; color: white; }
    .btn-primary:hover { background: #5568d3; transform: translateY(-1px); }
    .btn-secondary { background: white; color: #4a5568; border: 2px solid #e2e8f0; }
    .btn-secondary:hover { background: #f7fafc; }
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
      max-width: 1400px; 
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
      font-size: 18px; 
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
    .info-panel { 
      position: absolute; 
      bottom: 20px; 
      left: 20px; 
      background: rgba(255,255,255,0.95);
      padding: 16px; 
      border-radius: 12px; 
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      min-width: 220px; 
      backdrop-filter: blur(10px); 
      display: none;
    }
    .info-panel h3 { 
      font-size: 14px; 
      color: #4a5568; 
      margin-bottom: 12px; 
    }
    .info-item { 
      display: flex; 
      justify-content: space-between; 
      padding: 8px 0; 
      border-bottom: 1px solid #e2e8f0; 
    }
    .info-item:last-child { border-bottom: none; }
    .info-label { font-size: 13px; color: #718096; }
    .info-value { font-size: 13px; font-weight: 600; color: #2d3748; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Molecular Docking Result</h1>
    <div class="controls">
      <button class="btn btn-secondary" onclick="zoomIn()">🔍 +</button>
      <button class="btn btn-secondary" onclick="zoomOut()">🔍 -</button>
      <button class="btn btn-secondary" onclick="resetView()">🔄 Reset</button>
      <button class="btn btn-primary" onclick="changeStyle()">🎨 Style</button>
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
      <div class="info-item">
        <span class="info-label">File:</span>
        <span class="info-value">${filename}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Style:</span>
        <span class="info-value" id="current-style">Stick</span>
      </div>
      <div class="info-item">
        <span class="info-label">Atoms:</span>
        <span class="info-value" id="atom-count">—</span>
      </div>
    </div>
  </div>

  <script>
    let viewer, currentStyle = 0;
    const styles = [
      { name: 'Stick', style: 'stick' },
      { name: 'Cartoon', style: 'cartoon' },
      { name: 'Sphere', style: 'sphere' },
      { name: 'Line', style: 'line' }
    ];

    function initViewer() {
      const element = $('#viewport');
      viewer = $3Dmol.createViewer(element, { 
        backgroundColor: 'white', 
        antialias: true 
      });

      $.ajax({
        url: "${pdbqtUrl}",
        dataType: 'text',
        timeout: 30000,
        success: function(data) {
          const model = viewer.addModel(data, 'pdbqt');
          const atoms = model.selectedAtoms({});
          
          viewer.setStyle({}, { stick: { radius: 0.15 } });
          viewer.zoomTo();
          viewer.render();
          
          $('#loading').fadeOut(500);
          $('#info-panel').fadeIn(500);
          $('#atom-count').text(atoms.length);
        },
        error: function(xhr, status, error) {
          $('#loading').html('<div style="background: white; padding: 20px; border-radius: 12px;"><h2 style="color: #e53e3e;">Error Loading Structure</h2><p style="color: #4a5568; margin-top: 10px;">Status: ' + xhr.status + '<br>Error: ' + error + '</p></div>');
        }
      });
    }

    function changeStyle() {
      currentStyle = (currentStyle + 1) % styles.length;
      const style = styles[currentStyle];
      const styleConfig = {};
      styleConfig[style.style] = {};
      viewer.setStyle({}, styleConfig);
      viewer.render();
      $('#current-style').text(style.name);
    }

    function zoomIn() {
      viewer.zoom(1.2);
      viewer.render();
    }

    function zoomOut() {
      viewer.zoom(0.8);
      viewer.render();
    }

    function resetView() {
      viewer.zoomTo();
      viewer.render();
      currentStyle = 0;
      viewer.setStyle({}, { stick: { radius: 0.15 } });
      viewer.render();
      $('#current-style').text('Stick');
    }

    $(document).ready(function() {
      setTimeout(initViewer, 100);
    });
  </script>
</body>
</html>
  `;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(viewerHTML);
});

// ---------- DOCKING ENDPOINT ----------
app.post('/run-docking', (req, res) => {
  console.log('═══════════════════════════════════════════');
  console.log('🧪 Starting molecular docking simulation...');
  console.log('═══════════════════════════════════════════');

  if (!fs.existsSync(vinaPath)) {
    console.error('❌ Vina executable not found:', vinaPath);
    return res.status(500).json({ 
      error: 'Vina executable not found', 
      details: `Path: ${vinaPath}`,
      projectRoot: projectRoot
    });
  }

  // Check if Vina is executable and fix if needed
  try {
    fs.accessSync(vinaPath, fs.constants.X_OK);
    console.log('✅ Vina is executable');
  } catch (e) {
    console.error('❌ Vina is not executable, attempting to fix...');
    try {
      fs.chmodSync(vinaPath, '755');
      console.log('✅ Permissions fixed');
    } catch (chmodErr) {
      console.error('❌ Could not fix permissions:', chmodErr.message);
      return res.status(500).json({ 
        error: 'Vina is not executable and permissions cannot be fixed', 
        details: chmodErr.message,
        vinaPath: vinaPath
      });
    }
  }

  if (!fs.existsSync(configPath)) {
    console.error('❌ Config file not found:', configPath);
    return res.status(500).json({ 
      error: 'Config file not found', 
      details: `Path: ${configPath}` 
    });
  }

  const command = process.platform === 'win32'
    ? `"${vinaPath}" --config "${configPath}"`
    : `"${vinaPath}" --config "${configPath}"`;

  console.log('Command:', command);
  console.log('Working directory:', projectRoot);

  const startTime = Date.now();

  // Set a timeout to prevent hanging
  const execTimeout = setTimeout(() => {
    console.error('❌ Docking timeout - process took too long');
  }, 120000); // 2 minutes timeout

  exec(command, { 
    cwd: projectRoot, 
    maxBuffer: 1024 * 1024 * 10,
    timeout: 120000 // 2 minutes
  }, (err, stdout, stderr) => {
    clearTimeout(execTimeout);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    if (err) {
      console.error('❌ Vina execution failed');
      console.error('Error:', err.message);
      console.error('Stderr:', stderr);
      return res.status(500).json({ 
        error: 'Docking simulation failed', 
        details: stderr || err.message,
        duration: duration + 's',
        command: command,
        vinaPath: vinaPath
      });
    }

    console.log('✅ Docking completed in', duration, 'seconds');
    if (stdout) console.log('Stdout:', stdout);

    // Save stdout as log file for compatibility
    const logPath = path.join(outputDir, 'log.txt');
    fs.writeFileSync(logPath, stdout);
    console.log('✅ Log saved to:', logPath);

    // Parse scores from stdout
    let bestScore = 'Not found';
    let allScores = [];
    
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      // Match lines like: "1   -7.5      0.000      0.000"
      if (/^\d+\s+-?\d+\.\d+/.test(trimmed)) {
        const parts = trimmed.split(/\s+/);
        const score = parts[1];
        allScores.push(score);
        if (bestScore === 'Not found') {
          bestScore = score;
        }
      }
    }

    const protocol = req.protocol;
    const host = req.get('host');
    const viewerUrl = `${protocol}://${host}/viewer/output_docked.pdbqt`;
    const pdbqtUrl = `${protocol}://${host}/output/output_docked.pdbqt`;

    console.log('═══════════════════════════════════════════');
    console.log('📊 Results:');
    console.log('  Best Score:', bestScore, 'kcal/mol');
    console.log('  All Scores:', allScores.join(', '));
    console.log('  Duration:', duration, 's');
    console.log('═══════════════════════════════════════════');
    console.log('🔗 URLs:');
    console.log('  Viewer:', viewerUrl);
    console.log('  PDBQT:', pdbqtUrl);
    console.log('═══════════════════════════════════════════');

    res.json({
      success: true,
      message: 'Docking completed successfully!',
      score: bestScore + ' kcal/mol',
      bestScore: bestScore,
      allScores: allScores,
      pdbqtUrl: viewerUrl,
      viewerUrl: viewerUrl,
      downloadUrl: pdbqtUrl,
      duration: duration + 's',
      timestamp: new Date().toISOString()
    });
  });
});

// ---------- ERROR HANDLING ----------
app.use((req, res) => {
  console.log('❌ 404 Not Found:', req.method, req.path);
  res.status(404).json({ error: 'Endpoint not found', path: req.path });
});

app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

// ---------- START SERVER ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('═══════════════════════════════════════════');
  console.log('🚀 Molecular Docking Server Started');
  console.log('═══════════════════════════════════════════');
  console.log(`📡 Server:  http://localhost:${PORT}`);
  console.log(`🔬 Viewer:  http://localhost:${PORT}/viewer/output_docked.pdbqt`);
  console.log(`💚 Health:  http://localhost:${PORT}/health`);
  console.log(`📁 Files:   http://localhost:${PORT}/output/`);
  console.log('═══════════════════════════════════════════');
  console.log('📋 System Info:');
  console.log(`  Platform: ${process.platform}`);
  console.log(`  Node:     ${process.version}`);
  console.log(`  Root:     ${projectRoot}`);
  console.log(`  Vina:     ${fs.existsSync(vinaPath) ? '✓ Found' : '✗ Missing'}`);
  console.log(`  Config:   ${fs.existsSync(configPath) ? '✓ Found' : '✗ Missing'}`);
  console.log(`  Output:   ${outputDir}`);
  console.log('═══════════════════════════════════════════');
  console.log('✅ Server ready to accept requests');
  console.log('═══════════════════════════════════════════\n');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', reason);
});