package os.nude.companion

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

