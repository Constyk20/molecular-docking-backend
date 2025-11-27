// C:\docking_project\backend\server.js
const express = require('express');
const { exec } = require('child_process');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();

// Enhanced CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  maxAge: 86400
}));

// Security middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Enhanced body parsing with limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ---------- CONFIGURATION ----------
const projectRoot = process.env.NODE_ENV === 'production' 
  ? __dirname 
  : path.resolve(__dirname, '..');
  
const outputDir = path.join(projectRoot, 'output');
const logsDir = path.join(projectRoot, 'logs');
const vinaPath = path.join(projectRoot, 'tools', process.platform === 'win32' ? 'vina.exe' : 'vina');
const configPath = path.join(projectRoot, 'config.txt');

// Create necessary directories
const ensureDirectories = async () => {
  const dirs = [outputDir, logsDir];
  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
      console.log(`✅ Directory created/verified: ${dir}`);
    } catch (error) {
      console.error(`❌ Failed to create directory ${dir}:`, error.message);
    }
  }
};

// Initialize directories
ensureDirectories();

// Enhanced static file serving
app.use('/output', express.static(outputDir, {
  setHeaders: (res, filepath) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    if (filepath.endsWith('.pdbqt')) {
      res.setHeader('Content-Type', 'chemical/x-pdbqt; charset=utf-8');
    } else if (filepath.endsWith('.pdb')) {
      res.setHeader('Content-Type', 'chemical/x-pdb; charset=utf-8');
    }
  },
  dotfiles: 'deny',
  index: false
}));

// ---------- LOGGING UTILITIES ----------
const logger = {
  info: (message, meta = {}) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ℹ️ INFO: ${message}`, Object.keys(meta).length ? meta : '');
    logToFile('INFO', message, meta);
  },
  error: (message, error = null) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ❌ ERROR: ${message}`, error ? error : '');
    logToFile('ERROR', message, { error: error?.message || error });
  },
  warn: (message, meta = {}) => {
    const timestamp = new Date().toISOString();
    console.warn(`[${timestamp}] ⚠️ WARN: ${message}`, Object.keys(meta).length ? meta : '');
    logToFile('WARN', message, meta);
  },
  success: (message, meta = {}) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ✅ SUCCESS: ${message}`, Object.keys(meta).length ? meta : '');
    logToFile('SUCCESS', message, meta);
  }
};

const logToFile = async (level, message, meta = {}) => {
  try {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...meta
    };
    
    const logFile = path.join(logsDir, `server-${new Date().toISOString().split('T')[0]}.log`);
    await fs.appendFile(logFile, JSON.stringify(logEntry) + '\n');
  } catch (error) {
    console.error('Failed to write to log file:', error.message);
  }
};

// ---------- HEALTH CHECK ENDPOINT ----------
app.get('/health', async (req, res) => {
  try {
    const vinaExists = fsSync.existsSync(vinaPath);
    const configExists = fsSync.existsSync(configPath);
    
    let vinaExecutable = false;
    let vinaVersion = 'Unknown';
    
    if (vinaExists) {
      try {
        fsSync.accessSync(vinaPath, fsSync.constants.X_OK);
        vinaExecutable = true;
        
        // Try to get Vina version
        const versionOutput = await new Promise((resolve) => {
          exec(`"${vinaPath}" --help`, { timeout: 5000 }, (err, stdout) => {
            resolve(stdout || err?.message || 'Unknown');
          });
        });
        vinaVersion = versionOutput.split('\n')[0] || 'Unknown';
      } catch (e) {
        vinaExecutable = false;
      }
    }

    // Check directory permissions
    const outputWritable = await checkDirectoryWritable(outputDir);
    const logsWritable = await checkDirectoryWritable(logsDir);

    const healthInfo = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      system: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        uptime: process.uptime(),
        memory: process.memoryUsage()
      },
      components: {
        vina: {
          exists: vinaExists,
          executable: vinaExecutable,
          version: vinaVersion,
          path: vinaPath
        },
        config: {
          exists: configExists,
          path: configPath
        },
        directories: {
          output: { path: outputDir, writable: outputWritable },
          logs: { path: logsDir, writable: logsWritable }
        }
      },
      endpoints: {
        docking: '/run-docking',
        viewer: '/viewer/:filename',
        files: '/files',
        status: '/status'
      }
    };

    logger.info('Health check completed', { health: healthInfo });
    res.json(healthInfo);
  } catch (error) {
    logger.error('Health check failed', error);
    res.status(500).json({ 
      status: 'unhealthy', 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ---------- FILE MANAGEMENT ENDPOINTS ----------
app.get('/files', async (req, res) => {
  try {
    const files = await fs.readdir(outputDir);
    const fileDetails = await Promise.all(
      files.map(async (filename) => {
        const filePath = path.join(outputDir, filename);
        const stats = await fs.stat(filePath);
        return {
          name: filename,
          size: stats.size,
          modified: stats.mtime,
          type: path.extname(filename),
          url: `/output/${filename}`
        };
      })
    );

    res.json({
      success: true,
      files: fileDetails.filter(file => file.type === '.pdbqt' || file.type === '.pdb'),
      count: fileDetails.length,
      directory: outputDir
    });
  } catch (error) {
    logger.error('Failed to list files', error);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

app.delete('/files/:filename', async (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(outputDir, filename);
    
    if (!fsSync.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    await fs.unlink(filePath);
    logger.info('File deleted', { filename });
    
    res.json({ 
      success: true, 
      message: `File ${filename} deleted successfully` 
    });
  } catch (error) {
    logger.error('Failed to delete file', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// ---------- STATUS ENDPOINT ----------
app.get('/status', async (req, res) => {
  try {
    const health = await getHealthInfo();
    const recentLogs = await getRecentLogs(10);
    
    res.json({
      status: 'operational',
      serverTime: new Date().toISOString(),
      health,
      recentLogs,
      activeConnections: req.socket.server._connections
    });
  } catch (error) {
    logger.error('Status check failed', error);
    res.status(500).json({ error: 'Status check failed' });
  }
});

// ---------- ENHANCED 3D VIEWER ----------
app.get('/viewer/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  
  if (!filename.match(/\.(pdbqt|pdb)$/i)) {
    return res.status(400).send(createErrorPage('Invalid file type', 'Only .pdbqt and .pdb files are supported.'));
  }

  const filePath = path.join(outputDir, filename);
  
  if (!fsSync.existsSync(filePath)) {
    return res.status(404).send(createErrorPage(
      'File Not Found', 
      `The requested structure file <strong>${filename}</strong> does not exist.`,
      'Please run a docking simulation first or check the file name.'
    ));
  }

  const protocol = req.get('x-forwarded-proto') === 'https' ? 'https' : req.protocol;
  const host = req.get('host');
  const pdbqtUrl = `${protocol}://${host}/output/${filename}`;
  
  logger.info('3D Viewer request', { filename, protocol, host, pdbqtUrl });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(createViewerHTML(filename, pdbqtUrl, protocol, host));
});

// ---------- ENHANCED DOCKING ENDPOINT ----------
app.post('/run-docking', async (req, res) => {
  const startTime = Date.now();
  const dockingId = `docking_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  logger.info('Docking simulation started', { dockingId, ...req.body });

  try {
    // Validate system requirements
    const validation = await validateSystemRequirements();
    if (!validation.valid) {
      return res.status(500).json({
        success: false,
        error: 'System validation failed',
        details: validation.errors,
        dockingId
      });
    }

    const command = `"${vinaPath}" --config "${configPath}"`;
    logger.info('Executing Vina command', { command, dockingId });

    const result = await new Promise((resolve, reject) => {
      const childProcess = exec(command, { 
        cwd: projectRoot, 
        timeout: 300000, // 5 minutes
        maxBuffer: 1024 * 1024 * 20 // 20MB buffer
      }, (err, stdout, stderr) => {
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        
        if (err) {
          logger.error('Vina execution failed', { 
            dockingId, 
            error: err.message, 
            stderr, 
            duration 
          });
          reject({ error: err, stderr, duration });
          return;
        }

        resolve({ stdout, stderr, duration });
      });

      // Log process events
      childProcess.on('spawn', () => {
        logger.info('Vina process spawned', { dockingId, pid: childProcess.pid });
      });

      childProcess.on('exit', (code, signal) => {
        logger.info('Vina process exited', { dockingId, code, signal });
      });
    });

    const { stdout, stderr, duration } = result;

    // Save detailed log
    const logContent = `Docking ID: ${dockingId}
Timestamp: ${new Date().toISOString()}
Duration: ${duration}s
Command: ${command}

STDOUT:
${stdout}

STDERR:
${stderr}
`;

    const logPath = path.join(outputDir, `docking_${dockingId}.log`);
    await fs.writeFile(logPath, logContent);

    // Verify output file was created
    const outputFile = path.join(outputDir, 'output_docked.pdbqt');
    if (!fsSync.existsSync(outputFile)) {
      throw new Error('Docking completed but output file was not created');
    }

    // Parse results
    const dockingResults = parseDockingResults(stdout, outputFile);
    
    const protocol = req.get('x-forwarded-proto') === 'https' ? 'https' : req.protocol;
    const host = req.get('host');
    const viewerUrl = `${protocol}://${host}/viewer/output_docked.pdbqt`;
    const fileUrl = `${protocol}://${host}/output/output_docked.pdbqt`;

    const response = {
      success: true,
      message: 'Docking simulation completed successfully!',
      dockingId,
      ...dockingResults,
      pdbqtUrl: viewerUrl,
      viewerUrl,
      downloadUrl: fileUrl,
      logUrl: `${protocol}://${host}/output/docking_${dockingId}.log`,
      duration: duration + 's',
      timestamp: new Date().toISOString()
    };

    logger.success('Docking completed', { 
      dockingId, 
      bestScore: dockingResults.bestScore,
      duration,
      outputFile: outputFile 
    });

    res.json(response);

  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.error('Docking simulation failed', { 
      dockingId, 
      error: error.message,
      duration 
    });

    res.status(500).json({
      success: false,
      error: 'Docking simulation failed',
      details: error.stderr || error.message,
      dockingId,
      duration: duration + 's',
      timestamp: new Date().toISOString()
    });
  }
});

// ---------- UTILITY FUNCTIONS ----------
async function checkDirectoryWritable(dirPath) {
  try {
    const testFile = path.join(dirPath, `.write-test-${Date.now()}`);
    await fs.writeFile(testFile, 'test');
    await fs.unlink(testFile);
    return true;
  } catch {
    return false;
  }
}

async function validateSystemRequirements() {
  const errors = [];
  
  if (!fsSync.existsSync(vinaPath)) {
    errors.push(`Vina executable not found at: ${vinaPath}`);
  } else {
    try {
      fsSync.accessSync(vinaPath, fsSync.constants.X_OK);
    } catch (e) {
      try {
        fsSync.chmodSync(vinaPath, '755');
      } catch (chmodErr) {
        errors.push(`Vina is not executable and cannot fix permissions: ${chmodErr.message}`);
      }
    }
  }

  if (!fsSync.existsSync(configPath)) {
    errors.push(`Config file not found at: ${configPath}`);
  }

  const outputWritable = await checkDirectoryWritable(outputDir);
  if (!outputWritable) {
    errors.push(`Output directory is not writable: ${outputDir}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function parseDockingResults(stdout, outputFilePath) {
  const scores = [];
  let bestScore = null;
  let modes = [];

  // Parse scores from stdout
  const lines = stdout.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Match Vina output format: "1   -7.5      0.000      0.000"
    if (/^\d+\s+-?\d+\.\d+\s+/.test(trimmed)) {
      const parts = trimmed.split(/\s+/).filter(p => p);
      if (parts.length >= 2) {
        const score = parseFloat(parts[1]);
        scores.push(score);
        modes.push({
          mode: parseInt(parts[0]),
          score: score,
          rmsd_lb: parts[2] ? parseFloat(parts[2]) : null,
          rmsd_ub: parts[3] ? parseFloat(parts[3]) : null
        });
        
        if (bestScore === null || score < bestScore) {
          bestScore = score;
        }
      }
    }
  }

  // Get file stats
  const fileStats = fsSync.statSync(outputFilePath);
  const fileContent = fsSync.readFileSync(outputFilePath, 'utf8');
  const atomCount = (fileContent.match(/ATOM/g) || []).length;
  const bondCount = (fileContent.match(/BRANCH|ENDBRANCH|TORSION/g) || []).length;

  return {
    bestScore: bestScore,
    bestScoreFormatted: bestScore !== null ? `${bestScore} kcal/mol` : 'N/A',
    allScores: scores,
    modes: modes,
    fileStats: {
      size: fileStats.size,
      atoms: atomCount,
      bonds: bondCount,
      modified: fileStats.mtime
    }
  };
}

function createErrorPage(title, message, details = '') {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex; 
      justify-content: center; 
      align-items: center; 
      height: 100vh; 
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
      margin: 0; 
    }
    .error { 
      background: white; 
      padding: 40px; 
      border-radius: 16px; 
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      text-align: center; 
      max-width: 500px; 
    }
    h1 { color: #fc8181; margin-bottom: 16px; }
    p { color: #4a5568; line-height: 1.6; margin-bottom: 8px; }
    .details { color: #718096; font-size: 14px; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="error">
    <h1>⚠️ ${title}</h1>
    <p>${message}</p>
    ${details ? `<p class="details">${details}</p>` : ''}
  </div>
</body>
</html>`;
}

function createViewerHTML(filename, pdbqtUrl, protocol, host) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>3D Molecular Structure Viewer - ${filename}</title>
  
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/3.6.0/jquery.min.js"></script>
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
      background: rgba(255,255,255,0.98); 
      padding: 16px 24px; 
      box-shadow: 0 2px 20px rgba(0,0,0,0.1);
      display: flex; 
      justify-content: space-between; 
      align-items: center; 
      backdrop-filter: blur(10px);
      flex-wrap: wrap;
      gap: 12px;
      z-index: 100;
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
    .btn-primary:hover { background: #5568d3; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4); }
    .btn-secondary { background: white; color: #4a5568; border: 2px solid #e2e8f0; }
    .btn-secondary:hover { background: #f7fafc; transform: translateY(-1px); }
    .btn-success { background: #48bb78; color: white; }
    .btn-success:hover { background: #38a169; transform: translateY(-1px); }
    
    #viewport-container { 
      flex: 1; 
      display: flex; 
      justify-content: center; 
      align-items: center; 
      padding: 20px; 
      position: relative; 
      background: rgba(255,255,255,0.1);
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
      background: rgba(0,0,0,0.8);
      padding: 40px;
      border-radius: 16px;
      backdrop-filter: blur(10px);
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
      padding: 20px; 
      border-radius: 12px; 
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
      min-width: 250px; 
      backdrop-filter: blur(10px); 
      border: 1px solid rgba(255,255,255,0.2);
    }
    .info-panel h3 { 
      font-size: 14px; 
      color: #4a5568; 
      margin-bottom: 16px; 
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 8px;
    }
    .info-item { 
      display: flex; 
      justify-content: space-between; 
      padding: 8px 0; 
      border-bottom: 1px solid #f7fafc; 
    }
    .info-item:last-child { border-bottom: none; }
    .info-label { font-size: 13px; color: #718096; }
    .info-value { font-size: 13px; font-weight: 600; color: #2d3748; }
    
    .error-panel {
      background: #fed7d7;
      border: 1px solid #feb2b2;
      color: #c53030;
      padding: 20px;
      border-radius: 12px;
      margin: 20px;
      text-align: center;
    }
    
    @media (max-width: 768px) {
      .header { padding: 12px 16px; }
      .btn { padding: 8px 12px; font-size: 12px; }
      .info-panel { left: 10px; right: 10px; bottom: 10px; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Molecular Structure Viewer - ${filename}</h1>
    <div class="controls">
      <button class="btn btn-secondary" onclick="zoomIn()" title="Zoom In">🔍 +</button>
      <button class="btn btn-secondary" onclick="zoomOut()" title="Zoom Out">🔍 -</button>
      <button class="btn btn-secondary" onclick="resetView()" title="Reset View">🔄 Reset</button>
      <button class="btn btn-primary" onclick="changeStyle()" title="Change Visualization Style">🎨 Style</button>
      <button class="btn btn-success" onclick="downloadStructure()" title="Download Structure">📥 Download</button>
    </div>
  </div>

  <div id="viewport-container">
    <div class="loading" id="loading">
      <div class="spinner"></div>
      <div>Loading 3D Molecular Structure...</div>
      <div style="font-size: 14px; margin-top: 8px; opacity: 0.8;" id="loading-details"></div>
    </div>
    <div id="viewport"></div>
    
    <div class="info-panel" id="info-panel">
      <h3>Structure Information</h3>
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
      <div class="info-item">
        <span class="info-label">Status:</span>
        <span class="info-value" id="status">Loading...</span>
      </div>
    </div>
  </div>

  <script>
    let viewer = null;
    let currentStyle = 0;
    
    const styles = [
      { name: 'Stick', config: { stick: { radius: 0.15 } } },
      { name: 'Cartoon', config: { cartoon: { style: 'oval', color: 'spectrum' } } },
      { name: 'Sphere', config: { sphere: { scale: 0.3 } } },
      { name: 'Line', config: { line: { lineWidth: 2 } } },
      { name: 'Cross', config: { cross: { lineWidth: 1 } } }
    ];

    function updateLoading(message) {
      $('#loading-details').text(message);
      console.log('🔄', message);
    }

    function initViewer() {
      updateLoading('Initializing 3D viewer...');
      
      try {
        const element = $('#viewport').get(0);
        if (!element) {
          throw new Error('Viewport element not found');
        }

        viewer = $3Dmol.createViewer(element, {
          backgroundColor: 'white',
          antialias: true,
          quality: 'medium',
          defaultColors: $3Dmol.rasmolElementColors
        });

        updateLoading('Loading structure data...');
        
        // Load the PDBQT file
        $.ajax({
          url: '${pdbqtUrl}',
          dataType: 'text',
          timeout: 45000,
          crossDomain: true,
          beforeSend: function() {
            updateLoading('Fetching structure file...');
          },
          success: function(data) {
            try {
              updateLoading('Parsing molecular structure...');
              
              if (!data || data.trim().length === 0) {
                throw new Error('Structure file is empty');
              }

              // Add model to viewer
              viewer.addModel(data, 'pdbqt');
              
              const atoms = viewer.getModel().selectedAtoms({});
              
              if (atoms.length === 0) {
                throw new Error('No atoms found in structure file');
              }

              updateLoading('Rendering 3D structure...');
              
              // Apply initial style
              viewer.setStyle({}, styles[currentStyle].config);
              
              // Zoom to fit the structure
              viewer.zoomTo();
              viewer.render();
              
              // Update UI
              $('#loading').fadeOut(300);
              $('#info-panel').fadeIn(300);
              $('#atom-count').text(atoms.length.toLocaleString());
              $('#status').text('Loaded').css('color', '#48bb78');
              
              console.log('✅ Structure loaded successfully:', {
                atoms: atoms.length,
                style: styles[currentStyle].name
              });
              
            } catch (parseError) {
              console.error('❌ Structure parsing failed:', parseError);
              showError('Failed to parse molecular structure: ' + parseError.message);
            }
          },
          error: function(xhr, status, error) {
            console.error('❌ File loading failed:', { status, error, url: '${pdbqtUrl}' });
            showError('Failed to load structure file: ' + (error || status));
          }
        });
        
      } catch (initError) {
        console.error('❌ Viewer initialization failed:', initError);
        showError('Failed to initialize 3D viewer: ' + initError.message);
      }
    }

    function showError(message) {
      $('#loading').html(
        '<div class="error-panel">' +
        '<h3>❌ Loading Error</h3>' +
        '<p>' + message + '</p>' +
        '<button class="btn btn-primary" onclick="location.reload()" style="margin-top: 10px;">🔄 Retry</button>' +
        '</div>'
      );
      $('#status').text('Error').css('color', '#e53e3e');
    }

    function changeStyle() {
      if (!viewer) return;
      
      currentStyle = (currentStyle + 1) % styles.length;
      const style = styles[currentStyle];
      
      viewer.setStyle({}, style.config);
      viewer.render();
      
      $('#current-style').text(style.name);
      console.log('🎨 Style changed to:', style.name);
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
      console.log('🔄 View reset');
    }

    function downloadStructure() {
      const link = document.createElement('a');
      link.href = '${pdbqtUrl}';
      link.download = '${filename}';
      link.click();
      console.log('📥 Download initiated:', '${filename}');
    }

    // Keyboard shortcuts
    $(document).keydown(function(e) {
      if (!viewer) return;
      
      switch(e.key) {
        case '+': case '=': zoomIn(); break;
        case '-': case '_': zoomOut(); break;
        case 'r': case 'R': resetView(); break;
        case 's': case 'S': changeStyle(); break;
      }
    });

    // Initialize viewer when DOM is ready
    $(document).ready(function() {
      console.log('🚀 Starting molecular structure viewer...');
      console.log('📁 File:', '${filename}');
      console.log('🔗 URL:', '${pdbqtUrl}');
      
      setTimeout(initViewer, 100);
    });

    // Handle window resize
    $(window).resize(function() {
      if (viewer) {
        viewer.resize();
        viewer.render();
      }
    });
  </script>
</body>
</html>`;
}

async function getHealthInfo() {
  const vinaExists = fsSync.existsSync(vinaPath);
  const configExists = fsSync.existsSync(configPath);
  
  let vinaExecutable = false;
  if (vinaExists) {
    try {
      fsSync.accessSync(vinaPath, fsSync.constants.X_OK);
      vinaExecutable = true;
    } catch (e) {
      vinaExecutable = false;
    }
  }

  return {
    vina: { exists: vinaExists, executable: vinaExecutable },
    config: { exists: configExists },
    directories: {
      output: await checkDirectoryWritable(outputDir),
      logs: await checkDirectoryWritable(logsDir)
    }
  };
}

async function getRecentLogs(count = 10) {
  try {
    const logFiles = await fs.readdir(logsDir);
    const todayLog = logFiles.find(f => f.startsWith(`server-${new Date().toISOString().split('T')[0]}`));
    
    if (todayLog) {
      const logPath = path.join(logsDir, todayLog);
      const content = await fs.readFile(logPath, 'utf8');
      const lines = content.trim().split('\n').filter(line => line);
      return lines.slice(-count).map(line => JSON.parse(line));
    }
  } catch (error) {
    // Ignore log reading errors
  }
  return [];
}

// ---------- START SERVER ----------
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log('═══════════════════════════════════════════');
  console.log('🚀 Advanced Molecular Docking Server');
  console.log('═══════════════════════════════════════════');
  console.log(`📡 Server:  http://localhost:${PORT}`);
  console.log(`💚 Health:  http://localhost:${PORT}/health`);
  console.log(`🔬 Viewer:  http://localhost:${PORT}/viewer/output_docked.pdbqt`);
  console.log(`📊 Status:  http://localhost:${PORT}/status`);
  console.log(`📁 Files:   http://localhost:${PORT}/files`);
  console.log('═══════════════════════════════════════════');
  console.log('📋 System Information:');
  console.log(`  Platform: ${process.platform}`);
  console.log(`  Node.js:  ${process.version}`);
  console.log(`  Root:     ${projectRoot}`);
  console.log(`  Vina:     ${fsSync.existsSync(vinaPath) ? '✅ Found' : '❌ Missing'}`);
  console.log(`  Config:   ${fsSync.existsSync(configPath) ? '✅ Found' : '❌ Missing'}`);
  console.log(`  Output:   ${outputDir}`);
  console.log(`  Logs:     ${logsDir}`);
  console.log('═══════════════════════════════════════════');
  console.log('✅ Server is ready and accepting requests!');
  console.log('═══════════════════════════════════════════\n');
  
  logger.success('Server started successfully', {
    port: PORT,
    platform: process.platform,
    nodeVersion: process.version
  });
});

// Graceful shutdown handling
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  console.log('\n👋 Shutting down server gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  console.log('\n🔻 Received termination signal, shutting down...');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error);
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', { reason: reason?.message || reason, promise });
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});