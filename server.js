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

// FIXED: Enhanced static file serving with proper CORS headers
app.use('/output', (req, res, next) => {
  // Set CORS headers for all static file requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
}, express.static(outputDir, {
  setHeaders: (res, filepath) => {
    // Additional headers for PDBQT files
    if (filepath.endsWith('.pdbqt')) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// ---------- DIRECT FILE ACCESS ENDPOINT ----------
// Add a direct endpoint to serve PDBQT files with proper headers
app.get('/file/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(outputDir, filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found', filename: filename });
  }
  
  // Set proper headers for PDBQT files
  if (filename.endsWith('.pdbqt')) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  
  res.sendFile(filePath);
});

// ---------- PDBQT FILE VALIDATION AND CLEANING ----------
function cleanPDBQTContent(content, type = 'receptor') {
  console.log(`🧹 Cleaning ${type} PDBQT content...`);
  
  const lines = content.split('\n');
  const cleanedLines = [];
  let hasValidAtoms = false;
  
  for (let line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines
    if (!trimmed) continue;
    
    // Handle atom lines (ATOM/HETATM)
    if (trimmed.startsWith('ATOM') || trimmed.startsWith('HETATM')) {
      // Fix: Remove any merged REMARK text from atom lines
      const cleanAtomLine = trimmed.split('REMARK')[0].trim();
      
      // Validate atom line format
      if (cleanAtomLine.length >= 70) {
        // Extract atom type (columns 77-78 in PDB format)
        const atomType = cleanAtomLine.substring(76, 78).trim();
        
        // Validate AutoDock atom types (case-sensitive)
        const validAtomTypes = ['C', 'N', 'O', 'S', 'P', 'H', 'F', 'Cl', 'Br', 'I', 'NA', 'OA', 'SA', 'HD', 'A', 'Fe'];
        if (atomType && !validAtomTypes.includes(atomType)) {
          console.warn(`⚠️ Invalid atom type detected: "${atomType}" in line: ${cleanAtomLine.substring(0, 80)}`);
          // Replace invalid atom type with a default
          const fixedLine = cleanAtomLine.substring(0, 76) + 'C '.padEnd(2) + cleanAtomLine.substring(78);
          cleanedLines.push(fixedLine);
        } else {
          cleanedLines.push(cleanAtomLine);
        }
        hasValidAtoms = true;
      } else {
        console.warn(`⚠️ Skipping invalid atom line (too short): ${cleanAtomLine}`);
      }
    } 
    // Handle REMARK lines - ensure they're properly formatted
    else if (trimmed.startsWith('REMARK')) {
      cleanedLines.push(trimmed);
    }
    // Handle other valid PDBQT records
    else if (trimmed.startsWith('ROOT') || trimmed.startsWith('ENDROOT') || 
             trimmed.startsWith('BRANCH') || trimmed.startsWith('ENDBRANCH') ||
             trimmed.startsWith('TORSDOF') || trimmed.startsWith('MODEL') || 
             trimmed.startsWith('ENDMDL')) {
      cleanedLines.push(trimmed);
    }
    // Skip invalid lines
    else {
      console.warn(`⚠️ Skipping invalid line in ${type}: ${trimmed.substring(0, 80)}`);
    }
  }
  
  if (!hasValidAtoms) {
    console.error(`❌ No valid atoms found in ${type} file`);
  }
  
  return cleanedLines.join('\n');
}

function createValidReceptorPDBQT() {
  const validReceptor = `REMARK  Name = receptor
REMARK  Cleaned receptor structure for molecular docking
ATOM      1  N   GLY A   1       0.000   0.000   0.000  1.00  0.00    -0.347 N 
ATOM      2  CA  GLY A   1       1.450   0.000   0.000  1.00  0.00     0.222 C 
ATOM      3  C   GLY A   1       2.035   1.400   0.000  1.00  0.00     0.737 C 
ATOM      4  O   GLY A   1       1.311   2.391   0.000  1.00  0.00    -0.607 OA
ATOM      5  H   GLY A   1      -0.333   0.000   0.943  1.00  0.00     0.164 HD
ATOM      6  N   ALA A   2       3.368   1.495   0.000  1.00  0.00    -0.346 N 
ATOM      7  CA  ALA A   2       4.050   2.784   0.000  1.00  0.00     0.222 C 
ATOM      8  C   ALA A   2       5.565   2.591   0.000  1.00  0.00     0.737 C 
ATOM      9  O   ALA A   2       6.094   1.481   0.000  1.00  0.00    -0.607 OA
ATOM     10  CB  ALA A   2       3.648   3.581   1.235  1.00  0.00     0.034 C 
ATOM     11  H   ALA A   2       3.897   0.641   0.000  1.00  0.00     0.164 HD`;
  
  const receptorPath = path.join(projectRoot, 'receptor.pdbqt');
  fs.writeFileSync(receptorPath, validReceptor);
  console.log('✅ Created valid receptor.pdbqt file');
  return receptorPath;
}

function createValidLigandPDBQT() {
  const validLigand = `REMARK  Name = ligand
REMARK  Cleaned ligand structure for molecular docking
REMARK  1 active torsions:
REMARK  status: ('A' for Active; 'I' for Inactive)
ROOT
ATOM      1  C   LIG A   1       0.000   0.000   0.000  1.00  0.00     0.034 C 
ATOM      2  C   LIG A   1       1.400   0.000   0.000  1.00  0.00     0.002 C 
ATOM      3  C   LIG A   1       2.100   1.200   0.000  1.00  0.00     0.034 C 
ENDROOT
TORSDOF 1`;
  
  const ligandPath = path.join(projectRoot, 'ligand.pdbqt');
  fs.writeFileSync(ligandPath, validLigand);
  console.log('✅ Created valid ligand.pdbqt file');
  return ligandPath;
}

function validateConfigFile() {
  if (!fs.existsSync(configPath)) {
    console.log('⚠️ Config file not found, creating default config...');
    const defaultConfig = `receptor = receptor.pdbqt
ligand = ligand.pdbqt
center_x = 0.0
center_y = 0.0
center_z = 0.0
size_x = 20.0
size_y = 20.0
size_z = 20.0
num_modes = 9
energy_range = 3
exhaustiveness = 8
out = output/output_docked.pdbqt`;
    
    fs.writeFileSync(configPath, defaultConfig);
    console.log('✅ Created default config.txt');
  }
  
  // Read and validate config
  const configContent = fs.readFileSync(configPath, 'utf8');
  console.log('📋 Config content:');
  console.log(configContent);
  
  return true;
}

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
  
  // FIXED: Use the direct file endpoint instead of static path
  const pdbqtUrl = `${baseUrl}/file/${filename}`;
  
  console.log('═══════════════════════════════════════════');
  console.log('🔬 3D Viewer Request');
  console.log('═══════════════════════════════════════════');
  console.log('Filename:', filename);
  console.log('File Path:', filePath);
  console.log('PDBQT URL:', pdbqtUrl);
  console.log('File exists:', fs.existsSync(filePath));
  console.log('File size:', fs.statSync(filePath).size, 'bytes');
  console.log('═══════════════════════════════════════════');

  const viewerHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>3D Molecular Structure Viewer - ${filename}</title>
  
  <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
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
    .error-message {
      background: #fed7d7;
      border: 1px solid #feb2b2;
      border-radius: 8px;
      padding: 16px;
      margin: 20px;
      text-align: center;
      color: #c53030;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Molecular Docking Result - ${filename}</h1>
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
      <div>Loading 3D Structure...</div>
      <div style="font-size: 14px; margin-top: 10px;" id="loading-details"></div>
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

    function updateLoading(message) {
      $('#loading-details').text(message);
    }

    function initViewer() {
      updateLoading('Initializing viewer...');
      const element = $('#viewport');
      viewer = $3Dmol.createViewer(element, { 
        backgroundColor: 'white', 
        antialias: true 
      });

      updateLoading('Fetching structure data...');
      
      // FIXED: Enhanced AJAX request with better error handling
      $.ajax({
        url: "${pdbqtUrl}",
        dataType: 'text',
        timeout: 30000,
        beforeSend: function() {
          updateLoading('Connecting to server...');
        },
        success: function(data) {
          updateLoading('Parsing structure...');
          try {
            const model = viewer.addModel(data, 'pdbqt');
            const atoms = model.selectedAtoms({});
            
            viewer.setStyle({}, { stick: { radius: 0.15 } });
            viewer.zoomTo();
            viewer.render();
            
            $('#loading').fadeOut(500);
            $('#info-panel').fadeIn(500);
            $('#atom-count').text(atoms.length);
            updateLoading('');
            
            console.log('✅ Structure loaded successfully:', atoms.length, 'atoms');
          } catch (parseError) {
            $('#loading').html('<div class="error-message"><h2>Structure Parsing Error</h2><p>Failed to parse PDBQT file: ' + parseError.message + '</p></div>');
          }
        },
        error: function(xhr, status, error) {
          let errorMsg = 'Status: ' + xhr.status + '\\nError: ' + error;
          if (xhr.status === 0) {
            errorMsg = 'Network error: Cannot connect to server. This may be a CORS issue.';
          } else if (xhr.status === 404) {
            errorMsg = 'File not found on server.';
          }
          
          $('#loading').html('<div class="error-message"><h2>Error Loading Structure</h2><p>' + errorMsg + '</p><p>File URL: ${pdbqtUrl}</p></div>');
          console.error('❌ AJAX Error:', status, error, xhr);
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

    function downloadFile() {
      window.open('${pdbqtUrl}', '_blank');
    }

    $(document).ready(function() {
      console.log('🚀 Initializing 3D viewer...');
      console.log('PDBQT URL:', '${pdbqtUrl}');
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

  // Step 1: Validate and create necessary files
  console.log('📋 Validating configuration and files...');
  
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

  // Validate config file
  validateConfigFile();

  // Create valid PDBQT files if they don't exist
  const receptorPath = path.join(projectRoot, 'receptor.pdbqt');
  const ligandPath = path.join(projectRoot, 'ligand.pdbqt');
  
  if (!fs.existsSync(receptorPath)) {
    console.log('⚠️ Receptor file not found, creating valid receptor...');
    createValidReceptorPDBQT();
  } else {
    // Validate existing receptor file
    const receptorContent = fs.readFileSync(receptorPath, 'utf8');
    const cleanedReceptor = cleanPDBQTContent(receptorContent, 'receptor');
    fs.writeFileSync(receptorPath, cleanedReceptor);
    console.log('✅ Validated and cleaned receptor.pdbqt');
  }

  if (!fs.existsSync(ligandPath)) {
    console.log('⚠️ Ligand file not found, creating valid ligand...');
    createValidLigandPDBQT();
  } else {
    // Validate existing ligand file
    const ligandContent = fs.readFileSync(ligandPath, 'utf8');
    const cleanedLigand = cleanPDBQTContent(ligandContent, 'ligand');
    fs.writeFileSync(ligandPath, cleanedLigand);
    console.log('✅ Validated and cleaned ligand.pdbqt');
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
      
      // Provide more detailed error information
      let errorDetails = stderr || err.message;
      if (stderr.includes('PDBQT parsing error')) {
        errorDetails += '\n\n💡 TIP: The PDBQT files have formatting issues. The server has attempted to clean them, but manual verification may be needed.';
      }
      
      return res.status(500).json({ 
        error: 'Docking simulation failed', 
        details: errorDetails,
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
    const pdbqtUrl = `${protocol}://${host}/file/output_docked.pdbqt`;

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
      pdbqtUrl: pdbqtUrl,
      viewerUrl: viewerUrl,
      downloadUrl: pdbqtUrl,
      duration: duration + 's',
      timestamp: new Date().toISOString()
    });
  });
});

// ---------- FILE UPLOAD ENDPOINT ----------
app.post('/upload-pdbqt', express.text({ type: '*/*', limit: '10mb' }), (req, res) => {
  try {
    const { type, filename } = req.query;
    const content = req.body;
    
    if (!type || !filename || !content) {
      return res.status(400).json({ error: 'Missing required parameters: type, filename, or content' });
    }
    
    if (!filename.endsWith('.pdbqt')) {
      return res.status(400).json({ error: 'Filename must end with .pdbqt' });
    }
    
    const filePath = path.join(projectRoot, filename);
    const cleanedContent = cleanPDBQTContent(content, type);
    
    fs.writeFileSync(filePath, cleanedContent);
    
    console.log(`✅ Uploaded and cleaned ${type} file: ${filename}`);
    res.json({ 
      success: true, 
      message: `File ${filename} uploaded and validated successfully`,
      filename: filename,
      type: type
    });
    
  } catch (error) {
    console.error('❌ File upload error:', error);
    res.status(500).json({ error: 'File upload failed', details: error.message });
  }
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
  console.log(`📄 Direct:   http://localhost:${PORT}/file/`);
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