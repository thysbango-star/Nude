package os.rovian.core

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Rovian palette: deep ink, Rovian blue to teal (from the shield), and matte surfaces. */
object RovianColors {
    val Blue = Color(0xFF1450F0)
    val Sky = Color(0xFF1AA3DC)
    val Mint = Color(0xFF6FF0C6)
    val Red = Color(0xFFC8383A)
    val Amber = Color(0xFFB7791F)
    val Green = Color(0xFF2F8A57)
    val ShieldBrush = Brush.linearGradient(listOf(Color(0xFF6FF0C6), Color(0xFF1AA8DA), Color(0xFF1450F0)))
}

@Composable
fun RovianTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val scheme = if (dark) darkColorScheme(
        primary = Color(0xFF5FA8FF), onPrimary = Color(0xFF041332), secondary = RovianColors.Sky,
        background = Color(0xFF0B0D12), surface = Color(0xFF171A21), surfaceVariant = Color(0xFF1E222B),
        onSurfaceVariant = Color(0xFFA2A9B6), outlineVariant = Color(0x14FFFFFF), error = Color(0xFFFF6B5E),
    ) else lightColorScheme(
        primary = RovianColors.Blue, onPrimary = Color.White, secondary = RovianColors.Sky,
        background = Color(0xFFF2F4F7), surface = Color.White, surfaceVariant = Color(0xFFEBEEF3),
        onSurfaceVariant = Color(0xFF5A6170), outlineVariant = Color(0x14101828), error = RovianColors.Red,
    )
    MaterialTheme(colorScheme = scheme, content = content)
}

/** A matte card: frosted, softly bordered, never glossy. */
@Composable
fun MatteCard(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, radius: Dp = 22.dp, content: @Composable ColumnScope.() -> Unit) {
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.98f else 1f, spring(dampingRatio = 0.7f, stiffness = Spring.StiffnessMedium), label = "press")
    val shape = RoundedCornerShape(radius)
    Column(
        modifier.graphicsLayer { scaleX = scale; scaleY = scale }.clip(shape)
            .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.94f))
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape)
            .let { if (onClick != null) it.clickable(src, indication = null, onClick = onClick) else it }
            .padding(18.dp),
        content = content,
    )
}

/** Rises and fades in once, with a delay for staggered lists. */
@Composable
fun Rise(delayMs: Int = 0, modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    var shown by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { kotlinx.coroutines.delay(delayMs.toLong()); shown = true }
    val p by animateFloatAsState(if (shown) 1f else 0f, tween(320, easing = FastOutSlowInEasing), label = "rise")
    Box(modifier.graphicsLayer { alpha = p; translationY = (1 - p) * 36f; scaleX = 0.97f + 0.03f * p; scaleY = 0.97f + 0.03f * p }, content = content)
}
