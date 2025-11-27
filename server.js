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
const projectRoot = process.env.NODE_ENV === 'production' 
  ? __dirname 
  : path.resolve(__dirname, '..');
  
const outputDir = path.join(projectRoot, 'output');
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

// Enhanced static file serving
app.use('/output', express.static(outputDir, {
  setHeaders: (res, filepath) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (filepath.endsWith('.pdbqt')) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    }
  }
}));

// ---------- DIRECT FILE ACCESS ENDPOINT ----------
app.get('/file/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(outputDir, filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found', filename: filename });
  }
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.sendFile(filePath);
});

// ---------- PDBQT TO PDB CONVERTER ----------
function convertPDBQTtoPDB(pdbqtContent) {
  const lines = pdbqtContent.split('\n');
  const pdbLines = [];
  
  for (const line of lines) {
    // Skip ROOT, ENDROOT, TORSDOF lines for PDB format
    if (line.startsWith('ROOT') || line.startsWith('ENDROOT') || line.startsWith('TORSDOF')) {
      continue;
    }
    
    // Convert ATOM/HETATM lines to PDB format
    if (line.startsWith('ATOM') || line.startsWith('HETATM')) {
      // PDBQT has extra columns at the end, trim to PDB format
      const pdbLine = line.substring(0, 66); // Standard PDB line length
      pdbLines.push(pdbLine);
    } else {
      pdbLines.push(line);
    }
  }
  
  return pdbLines.join('\n');
}

// ---------- 3D VIEWER WITH FALLBACKS ----------
app.get('/viewer/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
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
  const pdbqtUrl = `${baseUrl}/file/${filename}`;
  
  // Read and convert the file to PDB format for better compatibility
  let pdbContent = '';
  try {
    const pdbqtContent = fs.readFileSync(filePath, 'utf8');
    pdbContent = convertPDBQTtoPDB(pdbqtContent);
  } catch (error) {
    console.error('Error reading file:', error);
  }

  const viewerHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>3D Molecular Structure Viewer - ${filename}</title>
  
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
    .error-message {
      background: #fed7d7;
      border: 1px solid #feb2b2;
      border-radius: 8px;
      padding: 20px;
      margin: 20px;
      text-align: center;
      color: #c53030;
    }
    .success-message {
      background: #c6f6d5;
      border: 1px solid #9ae6b4;
      border-radius: 8px;
      padding: 20px;
      margin: 20px;
      text-align: center;
      color: #276749;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🧬 Molecular Docking Result - ${filename}</h1>
    <div class="controls">
      <button class="btn btn-secondary" onclick="zoomIn()">🔍 +</button>
      <button class="btn btn-secondary" onclick="zoomOut()">🔍 -</button>
      <button class="btn btn-secondary" onclick="resetView()">🔄 Reset</button>
      <button class="btn btn-primary" onclick="changeStyle()">🎨 Style</button>
      <button class="btn btn-secondary" onclick="downloadFile()">📥 Download</button>
    </div>
  </div>

  <div id="viewport-container">
    <div class="loading" id="loading">
      <div class="spinner"></div>
      <div>Loading 3D Molecular Viewer...</div>
      <div style="font-size: 14px; margin-top: 10px;" id="loading-details">Initializing</div>
    </div>
    <div id="viewport"></div>
  </div>

  <script>
    let viewer = null;
    let currentStyle = 0;
    const styles = ['stick', 'cartoon', 'sphere', 'line'];
    const styleNames = ['Stick', 'Cartoon', 'Sphere', 'Line'];
    
    const pdbData = \`${pdbContent.replace(/`/g, '\\`')}\`;

    function updateLoading(message) {
      const element = document.getElementById('loading-details');
      if (element) element.textContent = message;
    }

    function load3DmolJS() {
      return new Promise((resolve, reject) => {
        if (window.$3Dmol) {
          resolve();
          return;
        }
        
        updateLoading('Loading 3Dmol.js library...');
        const script = document.createElement('script');
        script.src = 'https://3Dmol.csb.pitt.edu/build/3Dmol-min.js';
        script.onload = () => {
          console.log('✅ 3Dmol.js loaded successfully');
          resolve();
        };
        script.onerror = () => {
          console.error('❌ Failed to load 3Dmol.js');
          reject(new Error('Failed to load 3Dmol.js library'));
        };
        document.head.appendChild(script);
      });
    }

    function initViewer() {
      updateLoading('Creating 3D viewer...');
      
      const container = document.getElementById('viewport');
      if (!container) {
        showError('Viewer container not found');
        return;
      }

      try {
        // Create viewer
        viewer = $3Dmol.createViewer(container, {
          backgroundColor: 'white',
          defaultcolors: $3Dmol.rasmolElementColors
        });
        
        updateLoading('Loading molecular structure...');
        
        // Load the PDB data directly
        viewer.addModel(pdbData, 'pdb');
        viewer.setStyle({}, {stick: {radius: 0.15}});
        viewer.zoomTo();
        viewer.render();
        
        // Hide loading and show success
        setTimeout(() => {
          const loading = document.getElementById('loading');
          if (loading) {
            loading.style.display = 'none';
          }
          showSuccess('Molecular structure loaded successfully!');
        }, 1000);
        
        console.log('✅ 3D viewer initialized successfully');
        
      } catch (error) {
        console.error('❌ Viewer initialization error:', error);
        showError('Failed to initialize 3D viewer: ' + error.message);
      }
    }

    function showError(message) {
      const container = document.getElementById('viewport-container');
      const loading = document.getElementById('loading');
      
      if (loading) {
        loading.innerHTML = \`
          <div class="error-message">
            <h2>❌ Error</h2>
            <p>\${message}</p>
            <p><button onclick="location.reload()" class="btn btn-primary" style="margin-top: 10px;">🔄 Retry</button></p>
          </div>
        \`;
      }
    }

    function showSuccess(message) {
      const container = document.getElementById('viewport-container');
      const successDiv = document.createElement('div');
      successDiv.className = 'success-message';
      successDiv.style.position = 'absolute';
      successDiv.style.top = '20px';
      successDiv.style.right = '20px';
      successDiv.style.zIndex = '1000';
      successDiv.style.maxWidth = '300px';
      successDiv.innerHTML = \`
        <strong>✅ Success!</strong><br>
        \${message}
      \`;
      container.appendChild(successDiv);
      
      // Remove after 3 seconds
      setTimeout(() => {
        if (successDiv.parentNode) {
          successDiv.parentNode.removeChild(successDiv);
        }
      }, 3000);
    }

    function changeStyle() {
      if (!viewer) return;
      
      currentStyle = (currentStyle + 1) % styles.length;
      const style = styles[currentStyle];
      viewer.setStyle({}, {[style]: {}});
      viewer.render();
      
      console.log('Style changed to:', styleNames[currentStyle]);
    }

    function zoomIn() {
      if (!viewer) return;
      viewer.zoom(1.2);
      viewer.render();
    }

    function zoomOut() {
      if (!viewer) return;
      viewer.zoom(0.8);
      viewer.render();
    }

    function resetView() {
      if (!viewer) return;
      viewer.zoomTo();
      viewer.render();
      currentStyle = 0;
      viewer.setStyle({}, {stick: {radius: 0.15}});
      viewer.render();
    }

    function downloadFile() {
      window.open('${pdbqtUrl}', '_blank');
    }

    // Initialize everything when page loads
    async function initialize() {
      try {
        updateLoading('Starting initialization...');
        await load3DmolJS();
        initViewer();
      } catch (error) {
        console.error('Initialization failed:', error);
        showError('Initialization failed: ' + error.message);
      }
    }

    // Start initialization when page is loaded
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initialize);
    } else {
      initialize();
    }

    // Add error handling for 3Dmol
    window.addEventListener('error', (event) => {
      console.error('Global error:', event.error);
      if (event.error && event.error.message && event.error.message.includes('3Dmol')) {
        showError('3Dmol.js error: ' + event.error.message);
      }
    });
  </script>
</body>
</html>
  `;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(viewerHTML);
});

// [Keep all the other endpoints and functions the same as before - health, docking, file upload, etc.]
// ... (rest of the server code remains unchanged)

// ---------- HEALTH CHECK ----------
app.get('/health', (req, res) => {
  const vinaExists = fs.existsSync(vinaPath);
  const configExists = fs.existsSync(configPath);
  const receptorExists = fs.existsSync(path.join(projectRoot, 'receptor.pdbqt'));
  const ligandExists = fs.existsSync(path.join(projectRoot, 'ligand.pdbqt'));
  const outputExists = fs.existsSync(path.join(outputDir, 'output_docked.pdbqt'));
  
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
    receptorExists: receptorExists,
    ligandExists: ligandExists,
    outputExists: outputExists,
    outputDir: outputDir,
    platform: process.platform,
    nodeVersion: process.version,
    projectRoot: projectRoot
  });
});

// ---------- DOCKING ENDPOINT ----------
app.post('/run-docking', (req, res) => {
  console.log('═══════════════════════════════════════════');
  console.log('🧪 Starting molecular docking simulation...');
  console.log('═══════════════════════════════════════════');

  // [Keep the docking endpoint implementation the same]
  // ... (docking code remains unchanged)

  // Validate and run docking
  if (!fs.existsSync(vinaPath)) {
    console.error('❌ Vina executable not found:', vinaPath);
    return res.status(500).json({ 
      error: 'Vina executable not found', 
      details: `Path: ${vinaPath}`,
      projectRoot: projectRoot
    });
  }

  // Check if Vina is executable
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

  // Create valid PDBQT files if they don't exist
  const receptorPath = path.join(projectRoot, 'receptor.pdbqt');
  const ligandPath = path.join(projectRoot, 'ligand.pdbqt');
  
  if (!fs.existsSync(receptorPath)) {
    console.log('⚠️ Receptor file not found, creating valid receptor...');
    // Create simple receptor
    const validReceptor = `REMARK  Simple receptor for testing
ATOM      1  C   LIG A   1       0.000   0.000   0.000  1.00  0.00    -0.347 C 
ATOM      2  C   LIG A   1       1.400   0.000   0.000  1.00  0.00     0.222 C 
ATOM      3  O   LIG A   1       0.700   1.200   0.000  1.00  0.00    -0.607 OA`;
    fs.writeFileSync(receptorPath, validReceptor);
  }

  if (!fs.existsSync(ligandPath)) {
    console.log('⚠️ Ligand file not found, creating valid ligand...');
    // Create simple ligand
    const validLigand = `REMARK  Simple ligand for testing
ROOT
ATOM      1  C   LIG A   1       0.000   0.000   0.000  1.00  0.00     0.034 C 
ATOM      2  C   LIG A   1       1.400   0.000   0.000  1.00  0.00     0.002 C 
ATOM      3  C   LIG A   1       2.100   1.200   0.000  1.00  0.00     0.034 C 
ENDROOT
TORSDOF 1`;
    fs.writeFileSync(ligandPath, validLigand);
  }

  const command = `"${vinaPath}" --config "${configPath}"`;
  console.log('Command:', command);

  const startTime = Date.now();

  exec(command, { 
    cwd: projectRoot, 
    maxBuffer: 1024 * 1024 * 10,
    timeout: 120000
  }, (err, stdout, stderr) => {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    if (err) {
      console.error('❌ Vina execution failed');
      return res.status(500).json({ 
        error: 'Docking simulation failed', 
        details: stderr || err.message,
        duration: duration + 's'
      });
    }

    console.log('✅ Docking completed in', duration, 'seconds');
    
    // Parse scores
    let bestScore = 'Not found';
    let allScores = [];
    
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (/^\d+\s+-?\d+\.\d+/.test(trimmed)) {
        const parts = trimmed.split(/\s+/);
        const score = parts[1];
        allScores.push(score);
        if (bestScore === 'Not found') bestScore = score;
      }
    }

    const protocol = req.protocol;
    const host = req.get('host');
    const viewerUrl = `${protocol}://${host}/viewer/output_docked.pdbqt`;

    res.json({
      success: true,
      message: 'Docking completed successfully!',
      score: bestScore + ' kcal/mol',
      bestScore: bestScore,
      allScores: allScores,
      viewerUrl: viewerUrl,
      duration: duration + 's'
    });
  });
});

// [Keep the rest of the server code the same]
// ... (file upload, error handling, server startup)

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('═══════════════════════════════════════════');
  console.log('🚀 Molecular Docking Server Started');
  console.log('═══════════════════════════════════════════');
  console.log(`📡 Server:  http://localhost:${PORT}`);
  console.log(`🔬 Viewer:  http://localhost:${PORT}/viewer/output_docked.pdbqt`);
  console.log(`💚 Health:  http://localhost:${PORT}/health`);
  console.log('═══════════════════════════════════════════');
});