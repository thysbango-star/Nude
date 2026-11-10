package os.rovian.passgate

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.google.zxing.BarcodeFormat
import com.google.zxing.ResultPoint
import com.journeyapps.barcodescanner.BarcodeCallback
import com.journeyapps.barcodescanner.BarcodeResult
import com.journeyapps.barcodescanner.BarcodeView
import com.journeyapps.barcodescanner.DefaultDecoderFactory
import kotlinx.coroutines.delay
import os.rovian.core.glass.GlassButton
import os.rovian.core.glass.GlassCard
import os.rovian.core.glass.LocalGlass

/**
 * PassGate's own scanner: the camera fills the screen under glass, and only QR codes are decoded.
 * It hands back the first code it reads; whether that code is trusted is decided by [os.rovian.core.LinkCode]
 * and the pairing with the PC, never by the scanner.
 */
@Composable
fun Scanner(prompt: String, onResult: (String) -> Unit, onClose: () -> Unit) {
    val ctx = LocalContext.current
    val c = LocalGlass.current
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    var denied by remember { mutableStateOf(false) }
    var found by remember { mutableStateOf<String?>(null) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> granted = ok; denied = !ok }
    LaunchedEffect(Unit) { if (!granted) ask.launch(Manifest.permission.CAMERA) }
    // A short beat on the green frame so you see the code was read, then hand it over.
    LaunchedEffect(found) { found?.let { delay(420); onResult(it) } }
    BackHandler(onBack = onClose)

    Box(Modifier.fillMaxSize().background(Color(0xFF02050F))) {
        if (granted) CameraView(onCode = { if (found == null) found = it }, paused = found != null)
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Scan code", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                IconButton(onClick = onClose, modifier = Modifier.clip(CircleShape).background(Color(0x33FFFFFF))) { Icon(Icons.Default.Close, "Close", tint = Color.White) }
            }
            Spacer(Modifier.weight(1f))
            if (granted) ScanFrame(found != null, Modifier.size(270.dp))
            else GlassCard(Modifier.fillMaxWidth(), strong = true) {
                Text(if (denied) "PassGate can't use the camera" else "Allow the camera", color = c.ink, fontSize = 16.sp, fontWeight = FontWeight.Medium)
                Text(if (denied) "Camera access was turned off. Allow it in Android's settings for PassGate, or try again."
                    else "PassGate uses the camera only while this screen is open, to read the code Nude shows on your PC.",
                    color = c.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp, bottom = 12.dp))
                GlassButton("Allow camera", { ask.launch(Manifest.permission.CAMERA) })
            }
            Spacer(Modifier.weight(1f))
            Text(if (found != null) "Code read" else prompt, color = Color.White, fontSize = 14.sp, textAlign = TextAlign.Center,
                modifier = Modifier.clip(RoundedCornerShape(50)).background(Color(0x66071440)).padding(horizontal = 16.dp, vertical = 10.dp))
        }
    }
}

/** zxing's camera view, started and stopped with the screen's lifecycle so the camera is never left running. */
@Composable
private fun CameraView(onCode: (String) -> Unit, paused: Boolean) {
    val owner = LocalLifecycleOwner.current
    val latest by rememberUpdatedState(onCode)
    var view by remember { mutableStateOf<BarcodeView?>(null) }
    AndroidView(factory = { ctx ->
        BarcodeView(ctx).apply {
            decoderFactory = DefaultDecoderFactory(listOf(BarcodeFormat.QR_CODE))
            decodeContinuous(object : BarcodeCallback {
                override fun barcodeResult(result: BarcodeResult) { result.text?.let { latest(it) } }
                override fun possibleResultPoints(resultPoints: MutableList<ResultPoint>) {}
            })
            resume()
            view = this
        }
    }, modifier = Modifier.fillMaxSize(), onRelease = { it.pause() })
    LaunchedEffect(paused, view) { view?.let { if (paused) it.pause() } }
    DisposableEffect(owner) {
        val obs = LifecycleEventObserver { _, e ->
            when (e) {
                Lifecycle.Event.ON_RESUME -> if (!paused) view?.resume()
                Lifecycle.Event.ON_PAUSE -> view?.pause()
                else -> {}
            }
        }
        owner.lifecycle.addObserver(obs)
        onDispose { owner.lifecycle.removeObserver(obs); view?.pause() }
    }
}
