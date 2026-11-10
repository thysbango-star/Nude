package os.rovian.defender.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.rotate
import os.rovian.core.glass.LocalGlass
import os.rovian.defender.core.Protection

/**
 * The protection indicator: a translucent blue glass shield with light moving through it. Its colour follows the
 * real state, it breathes gently when all is well, and a sweep of light circles it while a scan is running.
 * Everything is drawn on the GPU in one Canvas.
 */
@Composable
fun GlassShield(state: Protection, scanning: Boolean, progress: Float, modifier: Modifier = Modifier) {
    val c = LocalGlass.current
    val target = when (state) {
        Protection.AT_RISK -> c.danger
        Protection.ATTENTION -> c.warn
        Protection.PROTECTED -> c.electric
        Protection.UNKNOWN -> c.sapphire
    }
    val tone by animateColorAsState(target, tween(900), label = "tone")
    val t = rememberInfiniteTransition(label = "shield")
    val breath by t.animateFloat(0f, 1f, infiniteRepeatable(tween(3400), RepeatMode.Reverse), label = "breath")
    val ripple by t.animateFloat(0f, 1f, infiniteRepeatable(tween(4200, easing = LinearEasing)), label = "ripple")
    val sweep by t.animateFloat(0f, 360f, infiniteRepeatable(tween(1600, easing = LinearEasing)), label = "sweep")
    val shown by animateFloatAsState(progress, spring(dampingRatio = 0.9f), label = "progress")

    Canvas(modifier) {
        val w = size.minDimension
        val cx = size.width / 2f
        val cy = size.height / 2f
        // Ambient glow and two slow ripples: the light the glass gives off.
        drawCircle(Brush.radialGradient(listOf(tone.copy(alpha = 0.32f + 0.14f * breath), Color.Transparent), center = Offset(cx, cy), radius = w * 0.62f), radius = w * 0.62f, center = Offset(cx, cy))
        for (k in 0..1) {
            val p = (ripple + k * 0.5f) % 1f
            drawCircle(tone.copy(alpha = (1f - p) * 0.22f), radius = w * (0.34f + 0.22f * p), center = Offset(cx, cy), style = Stroke(width = 1.5f * density))
        }
        // While scanning: a sweep of light around the shield, and the real progress as a ring.
        if (scanning) {
            rotate(sweep, Offset(cx, cy)) {
                drawArc(Brush.sweepGradient(listOf(Color.Transparent, c.cyan.copy(alpha = 0.9f), Color.Transparent), center = Offset(cx, cy)), 0f, 120f, false,
                    topLeft = Offset(cx - w * 0.43f, cy - w * 0.43f), size = Size(w * 0.86f, w * 0.86f), style = Stroke(width = 3f * density, cap = StrokeCap.Round))
            }
            drawArc(c.ice.copy(alpha = 0.18f), -90f, 360f, false, topLeft = Offset(cx - w * 0.47f, cy - w * 0.47f), size = Size(w * 0.94f, w * 0.94f), style = Stroke(width = 2f * density))
            drawArc(c.cyan, -90f, 360f * shown, false, topLeft = Offset(cx - w * 0.47f, cy - w * 0.47f), size = Size(w * 0.94f, w * 0.94f), style = Stroke(width = 2.5f * density, cap = StrokeCap.Round))
        }
        val shield = shieldPath(cx, cy, w * 0.56f)
        // The glass body: light at the top left, deep blue underneath, a cyan return at the base.
        drawPath(shield, Brush.linearGradient(listOf(Color.White.copy(alpha = 0.55f), tone.copy(alpha = 0.55f), c.sapphire.copy(alpha = 0.85f), c.cyan.copy(alpha = 0.55f)),
            start = Offset(cx - w * 0.3f, cy - w * 0.32f), end = Offset(cx + w * 0.25f, cy + w * 0.34f)))
        clipPath(shield) {
            // Depth: an inner shield, a little darker, like the far side of the glass.
            drawPath(shieldPath(cx, cy + w * 0.02f, w * 0.44f), Brush.verticalGradient(listOf(Color(0x33040A22), Color(0x66040A22)), startY = cy - w * 0.25f, endY = cy + w * 0.3f))
            // Reflection: a soft highlight that drifts with the breath.
            drawCircle(Brush.radialGradient(listOf(Color.White.copy(alpha = 0.55f), Color.Transparent), center = Offset(cx - w * (0.14f - 0.04f * breath), cy - w * 0.2f), radius = w * 0.26f),
                radius = w * 0.26f, center = Offset(cx - w * (0.14f - 0.04f * breath), cy - w * 0.2f))
            // Refraction band.
            drawRect(Brush.linearGradient(listOf(Color.Transparent, Color.White.copy(alpha = 0.16f), Color.Transparent), start = Offset(cx - w * 0.3f, cy + w * 0.1f), end = Offset(cx + w * 0.3f, cy - w * 0.05f)))
        }
        drawPath(shield, Brush.linearGradient(listOf(Color.White.copy(alpha = 0.95f), Color.White.copy(alpha = 0.15f), c.cyan.copy(alpha = 0.9f)),
            start = Offset(cx - w * 0.3f, cy - w * 0.3f), end = Offset(cx + w * 0.3f, cy + w * 0.3f)), style = Stroke(width = 2f * density))
        glyph(state, scanning, cx, cy, w)
    }
}

private fun shieldPath(cx: Float, cy: Float, s: Float) = Path().apply {
    val top = cy - s * 0.52f
    moveTo(cx, top)
    cubicTo(cx + s * 0.2f, top + s * 0.1f, cx + s * 0.36f, top + s * 0.12f, cx + s * 0.44f, top + s * 0.12f)
    cubicTo(cx + s * 0.46f, cy + s * 0.08f, cx + s * 0.3f, cy + s * 0.36f, cx, cy + s * 0.5f)
    cubicTo(cx - s * 0.3f, cy + s * 0.36f, cx - s * 0.46f, cy + s * 0.08f, cx - s * 0.44f, top + s * 0.12f)
    cubicTo(cx - s * 0.36f, top + s * 0.12f, cx - s * 0.2f, top + s * 0.1f, cx, top)
    close()
}

private fun DrawScope.glyph(state: Protection, scanning: Boolean, cx: Float, cy: Float, w: Float) {
    val stroke = Stroke(width = 4.5f * density, cap = StrokeCap.Round)
    val ink = Color.White
    when {
        scanning -> drawCircle(ink.copy(alpha = 0.9f), radius = w * 0.035f, center = Offset(cx, cy))
        state == Protection.PROTECTED -> drawPath(Path().apply { moveTo(cx - w * 0.09f, cy); lineTo(cx - w * 0.02f, cy + w * 0.07f); lineTo(cx + w * 0.1f, cy - w * 0.07f) }, ink, style = stroke)
        state == Protection.UNKNOWN -> drawCircle(ink.copy(alpha = 0.85f), radius = w * 0.03f, center = Offset(cx, cy))
        else -> {
            drawLine(ink, Offset(cx, cy - w * 0.09f), Offset(cx, cy + w * 0.02f), strokeWidth = 4.5f * density, cap = StrokeCap.Round)
            drawCircle(ink, radius = 2.8f * density, center = Offset(cx, cy + w * 0.08f))
        }
    }
}
