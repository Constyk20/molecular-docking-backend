// C:\docking_project\backend\server.js
const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();

// ✅ FIX 4: Enhanced CORS configuration
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

// ✅ FIX 4: CORS headers on static files with proper MIME types
app.use('/output', express.static(outputDir, {
  setHeaders: (res, filepath) => {
    // Set CORS headers for all files
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
  res.json({ 
    status: 'ok', 
    vinaExists: fs.existsSync(vinaPath),
    configExists: fs.existsSync(configPath),
    outputDir: outputDir,
    platform: process.platform
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

  // ✅ FIX 6: Build absolute URL dynamically
  const protocol = req.protocol;
  const host = req.get('host');
  const baseUrl = `${protocol}://${host}`;
  const pdbqtUrl = `${baseUrl}/output/${filename}`;
  
  // ✅ FIX 3: Add detailed console logging
  console.log('═══════════════════════════════════════════');
  console.log('🔬 3D Viewer Request');
  console.log('═══════════════════════════════════════════');
  console.log('Filename:', filename);
  console.log('File Path:', filePath);
  console.log('PDBQT URL:', pdbqtUrl);
  console.log('Protocol:', protocol);
  console.log('Host:', host);
  console.log('═══════════════════════════════════════════');

  const viewerHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>3D Molecular Structure Viewer - ${filename}</title>
  
  <!-- ✅ FIX 1: jQuery dependency (required by 3Dmol.js) -->
  <script src="https://code.jquery.com/jquery-3.6.0.min.js" 
          integrity="sha256-/xUj+3OJU5yExlq6GSYGSHk7tPXikynS7ogEvDej/m4=" 
          crossorigin="anonymous"></script>
  
  <script src="https://3Dmol.csb.pitt.edu/build/3Dmol-min.js"></script>
  
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
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
    .controls { 
      display: flex; 
      gap: 8px; 
      flex-wrap: wrap; 
    }
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
      user-select: none;
    }
    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .btn-primary { 
      background: #667eea; 
      color: white; 
    }
    .btn-primary:hover:not(:disabled) { 
      background: #5568d3; 
      transform: translateY(-1px); 
      box-shadow: 0 4px 12px rgba(102,126,234,0.4); 
    }
    .btn-secondary { 
      background: white; 
      color: #4a5568; 
      border: 2px solid #e2e8f0; 
    }
    .btn-secondary:hover:not(:disabled) { 
      background: #f7fafc; 
      border-color: #cbd5e0; 
    }
    .btn-success {
      background: #48bb78;
      color: white;
    }
    .btn-success:hover:not(:disabled) {
      background: #38a169;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(72,187,120,0.4);
    }
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
      position: relative; 
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
      max-width: 300px;
    }
    .info-panel h3 { 
      font-size: 14px; 
      color: #4a5568; 
      margin-bottom: 12px; 
      text-transform: uppercase; 
      letter-spacing: 0.5px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .info-panel h3::before {
      content: 'ℹ️';
    }
    .info-item { 
      display: flex; 
      justify-content: space-between; 
      padding: 8px 0; 
      border-bottom: 1px solid #e2e8f0; 
    }
    .info-item:last-child { 
      border-bottom: none; 
    }
    .info-label { 
      font-size: 13px; 
      color: #718096; 
    }
    .info-value { 
      font-size: 13px; 
      font-weight: 600; 
      color: #2d3748; 
    }
    .error-container { 
      color: #fc8181; 
      background: rgba(255,255,255,0.95); 
      padding: 30px; 
      border-radius: 12px; 
      max-width: 600px;
      text-align: left;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
    }
    .error-container h2 {
      margin-bottom: 12px;
      color: #e53e3e;
    }
    .error-container pre {
      background: #f7fafc;
      padding: 12px;
      border-radius: 8px;
      overflow-x: auto;
      font-size: 12px;
      margin-top: 12px;
      color: #2d3748;
    }
    .success-message {
      position: absolute;
      top: 20px;
      right: 20px;
      background: #48bb78;
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(72,187,120,0.4);
      display: none;
      z-index: 100;
      animation: slideIn 0.3s ease;
    }
    @keyframes slideIn {
      from { transform: translateX(100px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    .debug-info {
      position: absolute;
      top: 20px;
      left: 20px;
      background: rgba(0,0,0,0.7);
      color: #00ff00;
      padding: 12px;
      border-radius: 8px;
      font-family: 'Courier New', monospace;
      font-size: 11px;
      max-width: 400px;
      display: none;
      z-index: 100;
    }
    @media (max-width: 768px) {
      .header { 
        flex-direction: column; 
        gap: 12px; 
        align-items: stretch; 
      }
      .controls { 
        justify-content: center; 
      }
      .info-panel { 
        left: 10px; 
        right: 10px; 
        bottom: 10px;
        max-width: none;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Molecular Docking Result</h1>
    <div class="controls">
      <button class="btn btn-secondary" onclick="zoomIn()" title="Zoom In">🔍 +</button>
      <button class="btn btn-secondary" onclick="zoomOut()" title="Zoom Out">🔍 -</button>
      <button class="btn btn-secondary" onclick="resetView()" title="Reset View">🔄 Reset</button>
      <button class="btn btn-primary" onclick="changeStyle()" title="Change Style">🎨 Style</button>
      <button class="btn btn-success" onclick="downloadFile()" title="Download PDBQT">💾 Download</button>
      <button class="btn btn-secondary" onclick="toggleDebug()" title="Toggle Debug">🐛 Debug</button>
    </div>
  </div>

  <div id="viewport-container">
    <div class="loading" id="loading">
      <div class="spinner"></div>
      <div>Loading 3D Structure...</div>
      <div style="font-size: 14px; margin-top: 12px; opacity: 0.8;">Please wait...</div>
    </div>
    <div id="viewport"></div>
    <div class="success-message" id="success-msg">✓ Action completed</div>
    
    <!-- ✅ FIX 3: Debug info panel -->
    <div class="debug-info" id="debug-info">
      <div>Debug Console</div>
      <div id="debug-content"></div>
    </div>
    
    <div class="info-panel" id="info-panel">
      <h3>Structure Info</h3>
      <div class="info-item">
        <span class="info-label">File:</span>
        <span class="info-value">${filename}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Format:</span>
        <span class="info-value">PDBQT</span>
      </div>
      <div class="info-item">
        <span class="info-label">Viewer:</span>
        <span class="info-value">3Dmol.js</span>
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
    // ✅ FIX 3: Enhanced console logging
    const debugLogs = [];
    function log(message, data = null) {
      const timestamp = new Date().toLocaleTimeString();
      const logMsg = \`[\${timestamp}] \${message}\`;
      console.log(logMsg, data || '');
      debugLogs.push(logMsg + (data ? ': ' + JSON.stringify(data) : ''));
      updateDebugPanel();
    }

    function updateDebugPanel() {
      const debugContent = document.getElementById('debug-content');
      if (debugContent) {
        debugContent.innerHTML = debugLogs.slice(-10).join('<br>');
      }
    }

    function toggleDebug() {
      const debugPanel = document.getElementById('debug-info');
      debugPanel.style.display = debugPanel.style.display === 'none' ? 'block' : 'none';
    }

    let viewer, currentStyle = 0;
    const styles = [
      { name: 'Stick', style: 'stick', colorscheme: 'default' },
      { name: 'Cartoon', style: 'cartoon', colorscheme: 'spectrum' },
      { name: 'Sphere', style: 'sphere', colorscheme: 'element' },
      { name: 'Line', style: 'line', colorscheme: 'default' },
      { name: 'Cross', style: 'cross', colorscheme: 'default' }
    ];

    function initViewer() {
      log('🚀 Initializing 3Dmol viewer...');
      log('jQuery version', $.fn.jquery);
      log('3Dmol available', typeof $3Dmol !== 'undefined');
      
      const element = $('#viewport');
      log('Viewport element found', element.length > 0);
      
      try {
        viewer = $3Dmol.createViewer(element, { 
          backgroundColor: 'white', 
          antialias: true,
          cartoonQuality: 10
        });
        log('✅ Viewer created successfully');
      } catch (e) {
        log('❌ Viewer creation failed', e.message);
        showError('Failed to create 3D viewer: ' + e.message);
        return;
      }

      // ✅ FIX 6: Use absolute URL
      const url = "${pdbqtUrl}";
      log('📡 Loading structure from URL', url);

      // ✅ FIX 2: Using jQuery AJAX for file loading
      $.ajax({
        url: url,
        dataType: 'text',
        timeout: 30000,
        xhrFields: {
          withCredentials: false
        },
        // ✅ FIX 5: Enhanced error handling
        beforeSend: function() {
          log('📤 Sending request...');
        },
        success: function(data) {
          log('✅ File loaded successfully');
          log('File size (bytes)', data.length);
          log('First 100 chars', data.substring(0, 100));
          
          try {
            const model = viewer.addModel(data, 'pdbqt');
            log('✅ Model added to viewer');
            
            const atoms = model.selectedAtoms({});
            const atomCount = atoms.length;
            log('Atom count', atomCount);
            
            if (atomCount === 0) {
              throw new Error('No atoms found in structure');
            }
            
            // Set initial style
            viewer.setStyle({}, { stick: { radius: 0.15, colorscheme: 'default' } });
            log('✅ Style applied');
            
            viewer.zoomTo();
            log('✅ Zoomed to fit');
            
            viewer.render();
            log('✅ Rendering complete!');
            
            // Update UI
            $('#loading').fadeOut(500);
            $('#info-panel').fadeIn(500);
            $('#atom-count').text(atomCount);
            
            showSuccess('Structure loaded successfully!');
          } catch (e) {
            log('❌ Rendering error', e.message);
            showError('Failed to render structure: ' + e.message + '\\n\\nCheck debug console for details.');
          }
        },
        error: function(xhr, status, error) {
          log('❌ AJAX Error', { status, error, readyState: xhr.readyState, responseText: xhr.responseText });
          
          let errorMsg = 'Failed to load structure file';
          let details = '';
          
          if (status === 'timeout') {
            errorMsg = 'Request timed out';
            details = 'The file may be too large or the server is slow.';
          } else if (xhr.status === 404) {
            errorMsg = 'File not found (404)';
            details = 'URL: ${pdbqtUrl}';
          } else if (xhr.status === 0) {
            errorMsg = 'Network error or CORS issue';
            details = 'Check browser console and server CORS settings.';
          } else if (xhr.status >= 500) {
            errorMsg = 'Server error (' + xhr.status + ')';
            details = xhr.responseText || 'Internal server error';
          } else {
            errorMsg = 'HTTP ' + xhr.status + ': ' + error;
            details = xhr.responseText || 'Unknown error';
          }
          
          showError(errorMsg + '\\n\\n' + details);
        },
        complete: function() {
          log('📥 Request completed');
        }
      });
    }

    // ✅ FIX 5: Enhanced error display
    function showError(message) {
      log('❌ Showing error', message);
      $('#loading').html(\`
        <div class="error-container">
          <h2>❌ Error Loading Structure</h2>
          <p style="margin-top: 12px; color: #4a5568;">\${message}</p>
          <pre>URL: ${pdbqtUrl}</pre>
          <button class="btn btn-primary" onclick="location.reload()" style="margin-top: 20px;">
            🔄 Retry
          </button>
          <button class="btn btn-secondary" onclick="toggleDebug()" style="margin-top: 20px;">
            🐛 View Debug Log
          </button>
        </div>
      \`);
    }

    function showSuccess(message) {
      log('✅ ' + message);
      const msg = $('#success-msg');
      msg.text('✓ ' + message).fadeIn(300);
      setTimeout(() => msg.fadeOut(300), 3000);
    }

    function changeStyle() {
      currentStyle = (currentStyle + 1) % styles.length;
      const style = styles[currentStyle];
      
      const styleConfig = {};
      styleConfig[style.style] = { colorscheme: style.colorscheme };
      
      if (style.style === 'stick') {
        styleConfig.stick.radius = 0.15;
      }
      
      viewer.setStyle({}, styleConfig);
      viewer.render();
      
      $('#current-style').text(style.name);
      log('Style changed to ' + style.name);
      showSuccess('Style: ' + style.name);
    }

    function zoomIn() {
      viewer.zoom(1.2);
      viewer.render();
      showSuccess('Zoomed in');
    }

    function zoomOut() {
      viewer.zoom(0.8);
      viewer.render();
      showSuccess('Zoomed out');
    }

    function resetView() {
      viewer.zoomTo();
      viewer.render();
      currentStyle = 0;
      viewer.setStyle({}, { stick: { radius: 0.15, colorscheme: 'default' } });
      viewer.render();
      $('#current-style').text('Stick');
      showSuccess('View reset');
    }

    function downloadFile() {
      const url = "${pdbqtUrl}";
      const link = document.createElement('a');
      link.href = url;
      link.download = '${filename}';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showSuccess('Download started');
      log('📥 Download initiated');
    }

    // Keyboard shortcuts
    $(document).keydown(function(e) {
      if (e.key === '+' || e.key === '=') {
        zoomIn();
      } else if (e.key === '-' || e.key === '_') {
        zoomOut();
      } else if (e.key === 'r' || e.key === 'R') {
        resetView();
      } else if (e.key === 's' || e.key === 'S') {
        changeStyle();
      } else if (e.key === 'd' || e.key === 'D') {
        toggleDebug();
      }
    });

    // Initialize when ready
    $(document).ready(function() {
      log('📄 Document ready');
      log('Starting initialization...');
      setTimeout(initViewer, 100); // Small delay to ensure everything is loaded
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
      details: `Path: ${vinaPath}` 
    });
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
    : `${vinaPath} --config "${configPath}"`;

  console.log('Command:', command);
  console.log('Working directory:', projectRoot);

  const startTime = Date.now();

  exec(command, { cwd: projectRoot, maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    if (err) {
      console.error('❌ Vina execution failed');
      console.error('Error:', err.message);
      console.error('Stderr:', stderr);
      return res.status(500).json({ 
        error: 'Docking simulation failed', 
        details: stderr || err.message,
        duration: duration + 's'
      });
    }

    console.log('✅ Docking completed in', duration, 'seconds');
    if (stdout) console.log('Stdout:', stdout);

    const logPath = path.join(outputDir, 'log.txt');
    if (!fs.existsSync(logPath)) {
      console.error('❌ Log file not generated');
      return res.status(500).json({ 
        error: 'Log file not generated', 
        details: 'Vina did not create log.txt' 
      });
    }

    fs.readFile(logPath, 'utf8', (readErr, logData) => {
      if (readErr) {
        console.error('❌ Cannot read log file:', readErr.message);
        return res.status(500).json({ 
          error: 'Cannot read log file', 
          details: readErr.message 
        });
      }

      let bestScore = 'Not found';
      let allScores = [];
      
      for (const line of logData.split('\n')) {
        const trimmed = line.trim();
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
        pdbqtUrl: viewerUrl, // Flutter app expects this field
        viewerUrl: viewerUrl,
        downloadUrl: pdbqtUrl,
        duration: duration + 's',
        timestamp: new Date().toISOString()
      });
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
  console.log('═══════════════════════════════════════');
  console.log(`📡 Server:  https://molecular-docking-app.onrender.com`);
  console.log(`🔬 Viewer:  https://molecular-docking-app.onrender.com/viewer/output_docked.pdbqt`);
  console.log(`💚 Health:  https://molecular-docking-app.onrender.com/health`);
  console.log(`📁 Files:   https://molecular-docking-app.onrender.com/output/`);
  console.log('═══════════════════════════════════════════');
  console.log('📋 System Info:');
  console.log(`  Platform: ${process.platform}`);
  console.log(`  Node:     ${process.version}`);
  console.log(`  Vina:     ${fs.existsSync(vinaPath) ? '✓ Found' : '✗ Missing'}`);
  console.log(`  Config:   ${fs.existsSync(configPath) ? '✓ Found' : '✗ Missing'}`);
  console.log(`  Output:   ${outputDir}`);
  console.log('═══════════════════════════════════════════');
  console.log('✅ Server ready to accept requests');
  console.log('═══════════════════════════════════════════\n');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n═══════════════════════════════════════════');
  console.log('👋 Shutting down gracefully...');
  console.log('═══════════════════════════════════════════');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('═══════════════════════════════════════════');
  console.error('❌ Uncaught Exception:', err);
  console.error('═══════════════════════════════════════════');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('═══════════════════════════════════════════');
  console.error('❌ Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
  console.error('═══════════════════════════════════════════');
});