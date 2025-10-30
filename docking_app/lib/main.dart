import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';
import 'package:flutter/services.dart'; // For Clipboard

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const DockingApp());
}

class DockingApp extends StatelessWidget {
  const DockingApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Molecular Docking',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: Colors.blue,
          brightness: Brightness.light,
        ),
        useMaterial3: true,
        cardTheme: CardTheme(
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
      ),
      darkTheme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: Colors.blue,
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
        cardTheme: CardTheme(
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
      ),
      themeMode: ThemeMode.system,
      home: const DockingScreen(),
      debugShowCheckedModeBanner: false,
    );
  }
}

class DockingScreen extends StatefulWidget {
  const DockingScreen({super.key});

  @override
  State<DockingScreen> createState() => _DockingScreenState();
}

class _DockingScreenState extends State<DockingScreen> with TickerProviderStateMixin {
  bool isLoading = false;
  String result = "Ready to run molecular docking simulation";
  String? pdbqtUrl;
  String? dockingScore;
  int retryCount = 0;
  static const int maxRetries = 3;
  int elapsedSeconds = 0;
  Timer? progressTimer;
  AnimationController? _pulseController;
  AnimationController? _rotationController;

  late String backendUrl;
  final bool isDesktop = !kIsWeb && (Platform.isWindows || Platform.isMacOS || Platform.isLinux);

  @override
  void initState() {
    super.initState();
    _setupBackendUrl();
    _initializeAnimations();
  }

  void _initializeAnimations() {
    _pulseController?.dispose();
    _rotationController?.dispose();
    
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat(reverse: true);
    
    _rotationController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    )..repeat();
  }

  @override
  void dispose() {
    _pulseController?.dispose();
    _rotationController?.dispose();
    progressTimer?.cancel();
    super.dispose();
  }

  void _setupBackendUrl() {
    if (kIsWeb) {
      backendUrl = "/run-docking";
    } else if (Platform.isAndroid) {
      backendUrl = "http://10.0.2.2:3000/run-docking";
    } else if (Platform.isIOS) {
      backendUrl = "http://localhost:3000/run-docking";
    } else {
      backendUrl = "http://localhost:3000/run-docking";
    }
    debugPrint('Backend URL: $backendUrl');
  }

  void _startProgressTimer() {
    elapsedSeconds = 0;
    progressTimer?.cancel();
    progressTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (mounted) {
        setState(() {
          elapsedSeconds++;
        });
      }
    });
  }

  void _stopProgressTimer() {
    progressTimer?.cancel();
    elapsedSeconds = 0;
  }

  String _formatDuration(int seconds) {
    final minutes = seconds ~/ 60;
    final secs = seconds % 60;
    return '${minutes.toString().padLeft(2, '0')}:${secs.toString().padLeft(2, '0')}';
  }

  Future<void> runDocking() async {
    setState(() {
      isLoading = true;
      result = "Initializing docking simulation...";
      pdbqtUrl = null;
      dockingScore = null;
      retryCount = 0;
    });

    _startProgressTimer();
    await _performDocking();
  }

  Future<void> _performDocking() async {
    try {
      setState(() {
        result = retryCount > 0
            ? "Retrying docking simulation... (Attempt ${retryCount + 1}/$maxRetries)"
            : "Running molecular docking simulation...\nThis may take several minutes for complex molecules.";
      });

      final uri = Uri.parse(backendUrl);
      debugPrint('Sending request to: $uri');

      // Remove timeout to allow long-running docking processes
      final response = await http.post(
        uri,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      );

      if (!mounted) return;

      debugPrint('Response status: ${response.statusCode}');
      debugPrint('Response body: ${response.body}');

      if (response.statusCode == 200) {
        await _handleSuccessResponse(response);
      } else if (response.statusCode >= 500 && retryCount < maxRetries - 1) {
        retryCount++;
        await Future.delayed(Duration(seconds: retryCount * 2));
        await _performDocking();
      } else {
        await _handleErrorResponse(response);
      }
    } on SocketException catch (e) {
      await _handleNetworkError(e);
    } on HandshakeException catch (e) {
      await _handleSSLError(e);
    } catch (e, stackTrace) {
      debugPrint('Unexpected error: $e');
      debugPrint('Stack trace: $stackTrace');
      await _handleGenericError(e);
    } finally {
      if (mounted) {
        setState(() => isLoading = false);
        _stopProgressTimer();
      }
    }
  }

  Future<void> _handleSuccessResponse(http.Response response) async {
    try {
      final data = json.decode(response.body);
      
      if (data == null || data is! Map) {
        throw const FormatException('Invalid response format');
      }

      final score = data['score']?.toString() ?? 'N/A';
      final url = data['pdbqtUrl']?.toString();

      if (url == null || url.isEmpty) {
        throw const FormatException('Missing PDBQT URL in response');
      }

      setState(() {
        result = "Docking completed successfully!\nBinding affinity analysis complete.";
        pdbqtUrl = url;
        dockingScore = score;
      });

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                const Icon(Icons.check_circle, color: Colors.white),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text(
                        'Docking Complete!',
                        style: TextStyle(fontWeight: FontWeight.bold),
                      ),
                      Text('Score: $score kcal/mol'),
                    ],
                  ),
                ),
              ],
            ),
            backgroundColor: Colors.green.shade700,
            duration: const Duration(seconds: 4),
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
        );
      }
    } catch (e) {
      debugPrint('Error parsing response: $e');
      setState(() {
        result = "Error parsing server response: ${e.toString()}";
      });
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to parse response: ${e.toString()}'),
            backgroundColor: Colors.red,
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    }
  }

  Future<void> _handleErrorResponse(http.Response response) async {
    String errorMsg = "Server error (${response.statusCode})";
    
    try {
      final data = json.decode(response.body);
      if (data is Map && data.containsKey('error')) {
        errorMsg = data['error'].toString();
      }
    } catch (_) {
      errorMsg = response.body.isNotEmpty 
          ? response.body 
          : "Server returned error ${response.statusCode}";
    }

    setState(() {
      result = "⚠️ $errorMsg";
    });

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(errorMsg),
          backgroundColor: Colors.red.shade700,
          duration: const Duration(seconds: 5),
          behavior: SnackBarBehavior.floating,
          action: SnackBarAction(
            label: 'Retry',
            textColor: Colors.white,
            onPressed: () => runDocking(),
          ),
        ),
      );
    }
  }

  Future<void> _handleNetworkError(SocketException e) async {
    if (!mounted) return;
    
    final message = "Cannot connect to backend server.\nPlease ensure the server is running on port 3000.";
    
    setState(() {
      result = "⚠️ Connection Failed\n${e.message}";
    });

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'Connection Error',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 4),
            Text(message),
          ],
        ),
        backgroundColor: Colors.red.shade700,
        duration: const Duration(seconds: 6),
        behavior: SnackBarBehavior.floating,
        action: SnackBarAction(
          label: 'Retry',
          textColor: Colors.white,
          onPressed: () => runDocking(),
        ),
      ),
    );
  }

  Future<void> _handleSSLError(HandshakeException e) async {
    if (!mounted) return;
    
    setState(() {
      result = "⚠️ SSL/HTTPS Error\nSecure connection failed";
    });

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text('SSL error. Check backend certificate configuration.'),
        backgroundColor: Colors.red.shade700,
        duration: const Duration(seconds: 5),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  Future<void> _handleGenericError(Object e) async {
    if (!mounted) return;
    
    setState(() {
      result = "⚠️ Unexpected Error\n${e.toString()}";
    });

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Error: ${e.toString()}'),
        backgroundColor: Colors.red.shade700,
        duration: const Duration(seconds: 5),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  Future<void> _openInBrowser() async {
    if (pdbqtUrl == null) return;

    try {
      if (Platform.isWindows) {
        await _openUrlWindows(pdbqtUrl!);
      } else if (Platform.isMacOS) {
        await _openUrlMacOS(pdbqtUrl!);
      } else if (Platform.isLinux) {
        await _openUrlLinux(pdbqtUrl!);
      } else if (Platform.isAndroid || Platform.isIOS) {
        await _openUrlMobile(pdbqtUrl!);
      } else if (kIsWeb) {
        await _openUrlWeb(pdbqtUrl!);
      } else {
        _showManualUrlDialog(pdbqtUrl!);
      }
    } catch (e) {
      debugPrint('Error opening URL: $e');
      _showManualUrlDialog(pdbqtUrl!);
    }
  }

  Future<void> _openUrlWindows(String url) async {
    try {
      // Method 1: Using cmd start (most reliable on Windows)
      final result = await Process.run('cmd', ['/c', 'start', '', url]);
      if (result.exitCode == 0) {
        debugPrint('URL opened successfully using cmd');
        return;
      }

      // Method 2: Using PowerShell
      final result2 = await Process.run('powershell', ['Start-Process', url]);
      if (result2.exitCode == 0) {
        debugPrint('URL opened successfully using PowerShell');
        return;
      }

      // Method 3: Using rundll32 (older Windows)
      final result3 = await Process.run('rundll32', ['url.dll,FileProtocolHandler', url]);
      if (result3.exitCode == 0) {
        debugPrint('URL opened successfully using rundll32');
        return;
      }

      // If all methods fail, show manual dialog
      _showManualUrlDialog(url);
    } catch (e) {
      debugPrint('Windows URL opening failed: $e');
      _showManualUrlDialog(url);
    }
  }

  Future<void> _openUrlMacOS(String url) async {
    try {
      final result = await Process.run('open', [url]);
      if (result.exitCode == 0) {
        return;
      }
      _showManualUrlDialog(url);
    } catch (e) {
      debugPrint('macOS URL opening failed: $e');
      _showManualUrlDialog(url);
    }
  }

  Future<void> _openUrlLinux(String url) async {
    try {
      // Try xdg-open (most common)
      final result = await Process.run('xdg-open', [url]);
      if (result.exitCode == 0) {
        return;
      }

      // Try other common Linux browsers as fallback
      final browsers = ['google-chrome', 'chromium-browser', 'firefox'];
      for (final browser in browsers) {
        try {
          final result = await Process.run(browser, [url]);
          if (result.exitCode == 0) {
            return;
          }
        } catch (_) {
          continue;
        }
      }

      _showManualUrlDialog(url);
    } catch (e) {
      debugPrint('Linux URL opening failed: $e');
      _showManualUrlDialog(url);
    }
  }

  Future<void> _openUrlMobile(String url) async {
    try {
      final uri = Uri.parse(url);
      // For mobile, we can still try url_launcher as it usually works better
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      } else {
        _showManualUrlDialog(url);
      }
    } catch (e) {
      debugPrint('Mobile URL opening failed: $e');
      _showManualUrlDialog(url);
    }
  }

  Future<void> _openUrlWeb(String url) async {
    try {
      final uri = Uri.parse(url);
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (e) {
      debugPrint('Web URL opening failed: $e');
      _showManualUrlDialog(url);
    }
  }

  void _showManualUrlDialog(String url) {
    if (!mounted) return;
    
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Row(
          children: [
            Icon(Icons.open_in_browser, color: Colors.blue),
            SizedBox(width: 12),
            Text('Open 3D Structure'),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Copy the URL below and open it in your web browser to view the 3D molecular structure:',
              style: TextStyle(fontSize: 14),
            ),
            const SizedBox(height: 16),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: Theme.of(context).dividerColor),
              ),
              child: SelectableText(
                url,
                style: TextStyle(
                  color: Theme.of(context).colorScheme.onSurface,
                  fontSize: 12,
                  fontFamily: Platform.isWindows ? 'Courier New' : 'Monospace',
                ),
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Icon(Icons.info, size: 16, color: Colors.orange.shade700),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'This will open an interactive 3D viewer in your browser',
                    style: TextStyle(
                      fontSize: 12,
                      color: Colors.orange.shade700,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              _copyToClipboard(url);
              Navigator.pop(context);
            },
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.content_copy, size: 18),
                SizedBox(width: 8),
                Text('Copy URL'),
              ],
            ),
          ),
        ],
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
    );
  }

  void _copyToClipboard(String text) {
    Clipboard.setData(ClipboardData(text: text));
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Row(
            children: [
              Icon(Icons.check_circle, color: Colors.white, size: 20),
              SizedBox(width: 12),
              Text('URL copied to clipboard!'),
            ],
          ),
          backgroundColor: Colors.green.shade700,
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          duration: const Duration(seconds: 3),
        ),
      );
    }
  }

  Widget _buildStatusCard() {
    return Card(
      child: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              Theme.of(context).colorScheme.primaryContainer.withOpacity(0.3),
              Theme.of(context).colorScheme.secondaryContainer.withOpacity(0.2),
            ],
          ),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: Theme.of(context).colorScheme.outline.withOpacity(0.2),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: LayoutBuilder(
            builder: (context, constraints) {
              return SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: _getStatusColor().withOpacity(0.15),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Icon(
                            _getStatusIcon(),
                            color: _getStatusColor(),
                            size: 24,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                "Status",
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                  color: Theme.of(context).colorScheme.onSurface.withOpacity(0.6),
                                  letterSpacing: 0.5,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                _getStatusTitle(),
                                style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.bold,
                                  color: _getStatusColor(),
                                ),
                              ),
                            ],
                          ),
                        ),
                        if (isLoading) ...[
                          FadeTransition(
                            opacity: _pulseController ?? const AlwaysStoppedAnimation(1.0),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                              decoration: BoxDecoration(
                                color: Colors.blue.shade100,
                                borderRadius: BorderRadius.circular(20),
                              ),
                              child: Text(
                                _formatDuration(elapsedSeconds),
                                style: TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.bold,
                                  color: Colors.blue.shade700,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 16),
                    Text(
                      result,
                      style: TextStyle(
                        fontSize: 14,
                        height: 1.5,
                        color: Theme.of(context).colorScheme.onSurface.withOpacity(0.8),
                      ),
                    ),
                    if (dockingScore != null) ...[
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            colors: [
                              Colors.green.shade400,
                              Colors.green.shade600,
                            ],
                          ),
                          borderRadius: BorderRadius.circular(12),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.green.shade200.withOpacity(0.5),
                              blurRadius: 8,
                              offset: const Offset(0, 4),
                            ),
                          ],
                        ),
                        child: Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(8),
                              decoration: BoxDecoration(
                                color: Colors.white.withOpacity(0.2),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: const Icon(
                                Icons.analytics,
                                color: Colors.white,
                                size: 24,
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Text(
                                    'Binding Affinity',
                                    style: TextStyle(
                                      fontSize: 12,
                                      color: Colors.white70,
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    dockingScore!,
                                    style: const TextStyle(
                                      fontSize: 20,
                                      fontWeight: FontWeight.bold,
                                      color: Colors.white,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
              );
            },
          ),
        ),
      ),
    );
  }

  String _getStatusTitle() {
    if (result.contains("⚠️")) return "Error";
    if (result.contains("✓") || result.contains("completed")) return "Success";
    if (isLoading) return "Processing";
    return "Ready";
  }

  IconData _getStatusIcon() {
    if (result.contains("⚠️")) return Icons.error_outline;
    if (result.contains("✓") || result.contains("completed")) return Icons.check_circle;
    if (isLoading) return Icons.science;
    return Icons.rocket_launch;
  }

  Color _getStatusColor() {
    if (result.contains("⚠️")) return Colors.red;
    if (result.contains("✓") || result.contains("completed")) return Colors.green;
    if (isLoading) return Colors.blue;
    return Colors.orange;
  }

  Widget _buildViewer() {
    if (pdbqtUrl == null) {
      return Card(
        child: Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                Theme.of(context).colorScheme.surfaceContainerHighest.withOpacity(0.3),
                Theme.of(context).colorScheme.surfaceContainerHigh.withOpacity(0.2),
              ],
            ),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: Theme.of(context).dividerColor.withOpacity(0.5),
            ),
          ),
          child: Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              mainAxisSize: MainAxisSize.min,
              children: [
                _rotationController != null
                    ? RotationTransition(
                        turns: _rotationController!,
                        child: Icon(
                          Icons.threed_rotation,
                          size: 80,
                          color: Theme.of(context).colorScheme.primary.withOpacity(0.4),
                        ),
                      )
                    : Icon(
                        Icons.threed_rotation,
                        size: 80,
                        color: Theme.of(context).colorScheme.primary.withOpacity(0.4),
                      ),
                const SizedBox(height: 24),
                Text(
                  'No 3D Structure Available',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                    color: Theme.of(context).colorScheme.onSurface.withOpacity(0.7),
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Run a docking simulation to visualize results',
                  style: TextStyle(
                    fontSize: 14,
                    color: Theme.of(context).colorScheme.onSurface.withOpacity(0.5),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Card(
      child: Container(
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: Theme.of(context).dividerColor,
          ),
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [
                      Theme.of(context).colorScheme.primaryContainer,
                      Theme.of(context).colorScheme.secondaryContainer,
                    ],
                  ),
                  borderRadius: const BorderRadius.only(
                    topLeft: Radius.circular(16),
                    topRight: Radius.circular(16),
                  ),
                ),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.surface,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Icon(
                        Icons.science,
                        color: Theme.of(context).colorScheme.primary,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Docking Result',
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.bold,
                              color: Theme.of(context).colorScheme.onPrimaryContainer,
                            ),
                          ),
                          if (dockingScore != null)
                            Text(
                              'Affinity: $dockingScore kcal/mol',
                              style: TextStyle(
                                fontSize: 13,
                                color: Theme.of(context).colorScheme.onPrimaryContainer.withOpacity(0.8),
                              ),
                            ),
                        ],
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.open_in_browser),
                      tooltip: 'Open in Browser',
                      onPressed: _openInBrowser,
                      style: IconButton.styleFrom(
                        backgroundColor: Theme.of(context).colorScheme.surface,
                        foregroundColor: Theme.of(context).colorScheme.primary,
                      ),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      padding: const EdgeInsets.all(20),
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.primaryContainer.withOpacity(0.3),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        Icons.language,
                        size: 56,
                        color: Theme.of(context).colorScheme.primary,
                      ),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      isDesktop ? 'Desktop 3D Viewer' : 'View 3D Structure',
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      isDesktop
                          ? 'Click below to open the interactive 3D molecular structure\nin your default web browser.'
                          : 'The 3D structure is ready.\nOpen it in your browser to explore.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 14,
                        height: 1.6,
                        color: Theme.of(context).colorScheme.onSurface.withOpacity(0.7),
                      ),
                    ),
                    const SizedBox(height: 20),
                    Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        FilledButton.tonalIcon(
                          onPressed: _openInBrowser,
                          icon: const Icon(Icons.open_in_browser),
                          label: const Text('Open 3D Structure'),
                          style: FilledButton.styleFrom(
                            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
                            textStyle: const TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        const SizedBox(height: 12),
                        OutlinedButton.icon(
                          onPressed: () {
                            if (pdbqtUrl != null) {
                              _copyToClipboard(pdbqtUrl!);
                            }
                          },
                          icon: const Icon(Icons.content_copy),
                          label: const Text('Copy URL'),
                          style: OutlinedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.secondaryContainer.withOpacity(0.5),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: Theme.of(context).colorScheme.outline.withOpacity(0.2),
                        ),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.info_outline,
                            size: 16,
                            color: Theme.of(context).colorScheme.onSecondaryContainer,
                          ),
                          const SizedBox(width: 8),
                          Flexible(
                            child: Text(
                              'Powered by 3Dmol.js • Rotate, zoom & explore',
                              style: TextStyle(
                                fontSize: 12,
                                color: Theme.of(context).colorScheme.onSecondaryContainer,
                                fontWeight: FontWeight.w500,
                              ),
                              textAlign: TextAlign.center,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _getPlatformEmoji() {
    if (kIsWeb) return '🌐';
    if (Platform.isAndroid) return '📱';
    if (Platform.isIOS) return '📱';
    if (Platform.isWindows) return '💻';
    if (Platform.isMacOS) return '🍎';
    if (Platform.isLinux) return '🐧';
    return '💻';
  }

  String _getPlatformName() {
    if (kIsWeb) return 'Web';
    if (Platform.isAndroid) return 'Android';
    if (Platform.isIOS) return 'iOS';
    if (Platform.isWindows) return 'Windows';
    if (Platform.isMacOS) return 'macOS';
    if (Platform.isLinux) return 'Linux';
    return 'Desktop';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Theme.of(context).colorScheme.surfaceContainerLowest,
      appBar: AppBar(
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.primaryContainer,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(
                Icons.biotech,
                size: 20,
                color: Theme.of(context).colorScheme.onPrimaryContainer,
              ),
            ),
            const SizedBox(width: 12),
            const Text('Molecular Docking'),
          ],
        ),
        centerTitle: false,
        elevation: 0,
        scrolledUnderElevation: 0,
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Chip(
              avatar: Text(
                _getPlatformEmoji(),
                style: const TextStyle(fontSize: 14),
              ),
              label: Text(
                _getPlatformName(),
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
              ),
              padding: const EdgeInsets.symmetric(horizontal: 8),
              visualDensity: VisualDensity.compact,
              backgroundColor: Theme.of(context).colorScheme.secondaryContainer,
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            children: [
              FilledButton.icon(
                onPressed: isLoading ? null : runDocking,
                icon: isLoading
                    ? SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.5,
                          valueColor: AlwaysStoppedAnimation<Color>(
                            Theme.of(context).colorScheme.onPrimary,
                          ),
                        ),
                      )
                    : const Icon(Icons.science, size: 22),
                label: Text(
                  isLoading ? "Running Simulation..." : "Run Molecular Docking",
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 0.3,
                  ),
                ),
                style: FilledButton.styleFrom(
                  minimumSize: const Size(double.infinity, 56),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                  elevation: isLoading ? 0 : 2,
                ),
              ),
              const SizedBox(height: 20),
              _buildStatusCard(),
              const SizedBox(height: 20),
              Expanded(
                child: _buildViewer(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}