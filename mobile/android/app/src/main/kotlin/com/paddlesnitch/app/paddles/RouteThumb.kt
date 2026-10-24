package com.paddlesnitch.app.paddles

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.paddlesnitch.app.ui.PsColor
import com.paddlesnitch.app.ui.PsRadius
import kotlin.math.PI
import kotlin.math.cos

/**
 * [lat, lng] points → x/y in a w×h box with `pad` around, north up, keeping
 * the shape (the website's projectRoute, packages/timing/src/geo.ts).
 */
fun projectRoute(route: List<List<Double>>, w: Float, h: Float, pad: Float): List<Offset> {
    if (route.size < 2) return emptyList()
    val lats = route.map { it[0] }
    val kx = cos((lats.min() + lats.max()) / 2 * PI / 180).takeIf { it != 0.0 } ?: 1e-9
    val xs = route.map { it[1] * kx }
    val ys = route.map { -it[0] }
    val spanX = (xs.max() - xs.min()).takeIf { it != 0.0 } ?: 1e-9
    val spanY = (ys.max() - ys.min()).takeIf { it != 0.0 } ?: 1e-9
    val iw = w - 2 * pad; val ih = h - 2 * pad
    val scale = minOf(iw / spanX, ih / spanY)
    val offX = pad + (iw - spanX * scale) / 2
    val offY = pad + (ih - spanY * scale) / 2
    return xs.indices.map { Offset((offX + (xs[it] - xs.min()) * scale).toFloat(), (offY + (ys[it] - ys.min()) * scale).toFloat()) }
}

private val thumbShape = RoundedCornerShape(PsRadius.control)

/** A tiny map of a paddle's route: the track's shape with a green start dot. */
@Composable
fun RouteThumb(route: List<List<Double>>, size: Dp = 64.dp) {
    Box(
        Modifier.size(size).background(PsColor.bg, thumbShape).border(1.dp, PsColor.border, thumbShape)
            .semantics { contentDescription = "paddle route" },
        contentAlignment = Alignment.Center,
    ) {
        if (route.size < 2) {
            Text("no map", fontSize = 9.sp, color = PsColor.muted)
        } else {
            Canvas(Modifier.size(size)) {
                val pts = projectRoute(route, this.size.width, this.size.height, 7.dp.toPx())
                val path = Path().apply { moveTo(pts[0].x, pts[0].y); pts.drop(1).forEach { lineTo(it.x, it.y) } }
                drawPath(path, PsColor.primary, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
                drawCircle(PsColor.green, 2.6.dp.toPx(), pts[0])
            }
        }
    }
}

/** In place of the route, for a paddle without a map. */
@Composable
fun NoGpsTag(size: Dp = 64.dp) {
    Box(
        Modifier.size(size).background(PsColor.bg, thumbShape).border(1.dp, PsColor.border, thumbShape),
        contentAlignment = Alignment.Center,
    ) {
        Text("NO GPS", fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = PsColor.muted)
    }
}
