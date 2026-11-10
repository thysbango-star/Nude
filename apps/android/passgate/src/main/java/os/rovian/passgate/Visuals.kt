package os.rovian.passgate

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import os.rovian.core.glass.LocalGlass
import os.rovian.core.glass.glassEdge
import kotlin.math.cos
import kotlin.math.sin

/** Something linked to your identity, shown orbiting it. Lit only when it really is linked. */
data class OrbNode(val icon: ImageVector, val label: String, val lit: Boolean)

/**
 * The identity visual: your initials inside a sphere of blue glass, with the things linked to you (your PC,
 * this phone, Rovian Defender) circling slowly around it. The ring's colour is the real state: blue when the
 * identity is verified and locked, amber when something needs setting up.
 * Animations are read in the draw and layer phases only, so nothing recomposes per frame.
 */
@Composable
fun IdentityOrb(initials: String, avatar: Color?, tone: Color, nodes: List<OrbNode>, modifier: Modifier = Modifier) {
    val c = LocalGlass.current
    val t = rememberInfiniteTransition(label = "orb")
    val spin = t.animateFloat(0f, 360f, infiniteRepeatable(tween(70_000, easing = LinearEasing)), label = "spin")
    val breath = t.animateFloat(0f, 1f, infiniteRepeatable(tween(3600, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "breath")
    val toneNow by animateColorAsState(tone, tween(800), label = "tone")

    BoxWithConstraints(modifier, contentAlignment = Alignment.Center) {
        val d = if (maxWidth < maxHeight) maxWidth else maxHeight
        Canvas(Modifier.fillMaxSize()) {
            val w = size.minDimension
            val o = Offset(size.width / 2f, size.height / 2f)
            val b = breath.value
            drawCircle(Brush.radialGradient(listOf(toneNow.copy(alpha = 0.30f + 0.12f * b), Color.Transparent), center = o, radius = w * 0.55f), radius = w * 0.55f, center = o)
            // The orbit the linked things travel on, and a brighter arc of light moving along it.
            drawCircle(c.ice.copy(alpha = if (c.dark) 0.16f else 0.5f), radius = w * 0.42f, center = o, style = Stroke(1.2f * density))
            drawCircle(c.ice.copy(alpha = if (c.dark) 0.08f else 0.3f), radius = w * 0.33f, center = o, style = Stroke(1f * density))
            rotate(spin.value * 3f, o) {
                drawArc(Brush.sweepGradient(listOf(Color.Transparent, toneNow.copy(alpha = 0.9f), Color.Transparent), center = o), 0f, 110f, false,
                    topLeft = Offset(o.x - w * 0.42f, o.y - w * 0.42f), size = Size(w * 0.84f, w * 0.84f), style = Stroke(2.4f * density, cap = StrokeCap.Round))
            }
            // The glass sphere: light top left, deep sapphire below, a cyan rim.
            val r = w * 0.25f
            drawCircle(Brush.linearGradient(listOf(Color.White.copy(alpha = 0.5f), toneNow.copy(alpha = 0.45f), c.sapphire.copy(alpha = 0.8f), c.cyan.copy(alpha = 0.5f)),
                start = Offset(o.x - r, o.y - r), end = Offset(o.x + r, o.y + r)), radius = r, center = o)
            drawCircle(Brush.radialGradient(listOf(Color.White.copy(alpha = 0.55f), Color.Transparent), center = Offset(o.x - r * (0.4f - 0.1f * b), o.y - r * 0.45f), radius = r * 0.6f),
                radius = r * 0.6f, center = Offset(o.x - r * (0.4f - 0.1f * b), o.y - r * 0.45f))
            drawCircle(Brush.linearGradient(listOf(Color.White.copy(alpha = 0.9f), Color.White.copy(alpha = 0.1f), c.cyan.copy(alpha = 0.9f)),
                start = Offset(o.x - r, o.y - r), end = Offset(o.x + r, o.y + r)), radius = r, center = o, style = Stroke(1.6f * density))
        }
        val bg = avatar ?: c.electric
        Box(Modifier.size(d * 0.34f).clip(CircleShape).background(Brush.linearGradient(listOf(bg.copy(alpha = 0.92f), c.sapphire))).border(1.5.dp, glassEdge(), CircleShape),
            contentAlignment = Alignment.Center) {
            Text(initials, color = Color.White, fontSize = (d.value * 0.105f).sp, fontWeight = FontWeight.Medium)
        }
        nodes.forEachIndexed { i, n ->
            val base = i * 360f / nodes.size - 90f
            val radius = d * 0.42f
            Box(Modifier.graphicsLayer {
                val a = Math.toRadians((base + spin.value).toDouble())
                translationX = (radius.toPx() * cos(a)).toFloat()
                translationY = (radius.toPx() * sin(a)).toFloat()
            }.size(38.dp).clip(CircleShape)
                .background(if (n.lit) Brush.linearGradient(listOf(Color(0xFF5B8DFF), c.electric)) else Brush.linearGradient(listOf(c.glassStrong, c.glass)))
                .border(1.dp, glassEdge(), CircleShape), contentAlignment = Alignment.Center) {
                Icon(n.icon, n.label, tint = if (n.lit) Color.White else c.faint, modifier = Modifier.size(18.dp))
            }
        }
    }
}

enum class LockPhase { IDLE, ASKING, SUCCESS, FAILED }

/**
 * The unlock visual: a fingerprint drawn in light inside glass. While Android's prompt is open the ridges
 * shimmer; when the prompt says yes they fill in from the centre and turn to a tick; a failure shakes it.
 * It only reacts to BiometricPrompt's real result.
 */
@Composable
fun BiometricOrb(phase: LockPhase, modifier: Modifier = Modifier) {
    val c = LocalGlass.current
    val t = rememberInfiniteTransition(label = "bio")
    val shimmer = t.animateFloat(0f, 1f, infiniteRepeatable(tween(1800, easing = LinearEasing)), label = "shimmer")
    val breath = t.animateFloat(0f, 1f, infiniteRepeatable(tween(3000), RepeatMode.Reverse), label = "b")
    val fill by animateFloatAsState(if (phase == LockPhase.SUCCESS) 1f else 0f, tween(520, easing = FastOutSlowInEasing), label = "fill")
    val shake by animateFloatAsState(if (phase == LockPhase.FAILED) 1f else 0f, spring(dampingRatio = 0.25f, stiffness = 600f), label = "shake")
    val tone by animateColorAsState(when (phase) { LockPhase.SUCCESS -> c.good; LockPhase.FAILED -> c.warn; else -> c.electric }, tween(400), label = "tone")

    Canvas(modifier.graphicsLayer { translationX = sin(shake * 18f) * 14f * shake }) {
        val w = size.minDimension
        val o = Offset(size.width / 2f, size.height / 2f)
        drawCircle(Brush.radialGradient(listOf(tone.copy(alpha = 0.34f + 0.12f * breath.value), Color.Transparent), center = o, radius = w * 0.5f), radius = w * 0.5f, center = o)
        val r = w * 0.34f
        drawCircle(Brush.linearGradient(listOf(Color.White.copy(alpha = if (c.dark) 0.18f else 0.7f), tone.copy(alpha = 0.25f), c.sapphire.copy(alpha = 0.45f)),
            start = Offset(o.x - r, o.y - r), end = Offset(o.x + r, o.y + r)), radius = r, center = o)
        drawCircle(Brush.linearGradient(listOf(Color.White.copy(alpha = 0.9f), Color.White.copy(alpha = 0.1f), c.cyan.copy(alpha = 0.8f)),
            start = Offset(o.x - r, o.y - r), end = Offset(o.x + r, o.y + r)), radius = r, center = o, style = Stroke(1.6f * density))

        // Ridges: concentric open arcs, each a little offset, like a fingertip.
        val ridges = 6
        for (k in 0 until ridges) {
            val rr = w * (0.05f + 0.035f * k)
            val gap = 70f - k * 6f
            val start = 90f + gap / 2f + (if (k % 2 == 0) 8f else -8f)
            val lit = fill * ridges > k
            val wave = ((shimmer.value * ridges - k + ridges) % ridges) / ridges
            val alpha = when {
                lit -> 1f
                phase == LockPhase.ASKING -> 0.35f + 0.5f * (1f - wave)
                else -> 0.55f
            }
            val ink = if (lit) Color.White else (if (c.dark) c.ice else c.sapphire)
            drawArc(ink.copy(alpha = alpha * (1f - 0.85f * fill)), start, 360f - gap, false, topLeft = Offset(o.x - rr, o.y - rr + w * 0.02f), size = Size(rr * 2, rr * 2),
                style = Stroke(2.6f * density, cap = StrokeCap.Round))
        }
        if (fill > 0f) {
            drawCircle(tone.copy(alpha = 0.85f * fill), radius = r * 0.62f * fill, center = o)
            val p = Path().apply { moveTo(o.x - w * 0.08f, o.y); lineTo(o.x - w * 0.02f, o.y + w * 0.06f); lineTo(o.x + w * 0.09f, o.y - w * 0.06f) }
            drawPath(p, Color.White.copy(alpha = fill), style = Stroke(4f * density, cap = StrokeCap.Round))
        }
    }
}

/**
 * The scanner's frame: glass corners around the camera view and a line of light passing over it.
 * It is drawn only while the camera is really running and looking for a code.
 */
@Composable
fun ScanFrame(found: Boolean, modifier: Modifier = Modifier) {
    val c = LocalGlass.current
    val t = rememberInfiniteTransition(label = "scan")
    val y = t.animateFloat(0f, 1f, infiniteRepeatable(tween(2200, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "y")
    val tone by animateColorAsState(if (found) c.good else c.cyan, tween(250), label = "tone")
    val close by animateFloatAsState(if (found) 1f else 0f, spring(dampingRatio = 0.6f), label = "close")
    Canvas(modifier) {
        val inset = size.minDimension * 0.06f * close
        val l = inset; val top = inset; val rgt = size.width - inset; val bot = size.height - inset
        val arm = size.minDimension * 0.16f
        val s = Stroke(4f * density, cap = StrokeCap.Round)
        fun corner(x: Float, yy: Float, dx: Float, dy: Float) {
            drawLine(tone, Offset(x, yy), Offset(x + dx * arm, yy), s.width, StrokeCap.Round)
            drawLine(tone, Offset(x, yy), Offset(x, yy + dy * arm), s.width, StrokeCap.Round)
        }
        drawRoundRect(Color.White.copy(alpha = 0.06f), Offset(l, top), Size(rgt - l, bot - top), CornerRadius(28.dp.toPx()))
        corner(l, top, 1f, 1f); corner(rgt, top, -1f, 1f); corner(l, bot, 1f, -1f); corner(rgt, bot, -1f, -1f)
        if (!found) {
            val ly = top + (bot - top) * (0.08f + 0.84f * y.value)
            drawRect(Brush.verticalGradient(listOf(Color.Transparent, tone.copy(alpha = 0.28f)), startY = ly - 60.dp.toPx(), endY = ly), Offset(l + 12.dp.toPx(), ly - 60.dp.toPx()), Size(rgt - l - 24.dp.toPx(), 60.dp.toPx()))
            drawLine(Brush.horizontalGradient(listOf(Color.Transparent, tone, Color.Transparent), startX = l, endX = rgt), Offset(l + 12.dp.toPx(), ly), Offset(rgt - 12.dp.toPx(), ly), 2.5f * density, StrokeCap.Round)
        }
    }
}

/** A small mark for PassGate itself: the gate drawn in white on a blue glass disc. */
@Composable
fun GateMark(size: Int, modifier: Modifier = Modifier) {
    val c = LocalGlass.current
    Box(modifier.size(size.dp).clip(CircleShape).background(Brush.linearGradient(listOf(Color(0xFF5B8DFF), c.sapphire))).border(1.dp, glassEdge(), CircleShape),
        contentAlignment = Alignment.Center) {
        androidx.compose.foundation.Image(androidx.compose.ui.res.painterResource(R.drawable.ic_passgate_mark), "PassGate", Modifier.size((size * 1.25f).dp))
    }
}
