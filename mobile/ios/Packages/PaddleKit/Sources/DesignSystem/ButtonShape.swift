import SwiftUI

extension ButtonBorderShape {
    /// Every app button: the control radius from the tokens (`rounded-control`,
    /// 6 px on the website). iOS 26 draws bordered buttons as capsules unless
    /// told otherwise (#793). The app sets it once, on the window.
    public static var control: ButtonBorderShape { .roundedRectangle(radius: Radius.control) }
}
