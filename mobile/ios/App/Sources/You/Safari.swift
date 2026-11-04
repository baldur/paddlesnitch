import DesignSystem
import SafariServices
import SwiftUI

extension View {
    /// The website inside the app, in Safari's own view, while `url` is set;
    /// `closed` clears it once Safari has gone, however it went (Done, a
    /// swipe in from the edge, taken down with what it sat on, or refused).
    /// Full screen, Safari's own look: it ignores `.pageSheet`. Presented by
    /// UIKit, the way Safari's view is made to be shown, so its Done takes
    /// down exactly Safari. Inside a SwiftUI sheet it didn't: on iOS 17 Done
    /// closed nothing (from Account, and from a sheet on a sheet), and on
    /// newer iOS closing that sheet again took the screen under it too
    /// (#878, #884).
    func safari(url: URL?, closed: @escaping () -> Void) -> some View {
        background(SafariPresenter(url: url, closed: closed))
    }
}

/// An empty view controller on the screen that opens the page. Safari is
/// presented from the top of the window, so a screen pushed above this one
/// (a paddle opened from a tracker) can open it too: the anchor's own screen
/// is then out of the window. It takes Safari down if the app clears `url`
/// first (a sign-out) or the screen goes.
private struct SafariPresenter: UIViewControllerRepresentable {
    let url: URL?
    let closed: () -> Void

    func makeUIViewController(context: Context) -> UIViewController { UIViewController() }

    func updateUIViewController(_ anchor: UIViewController, context: Context) {
        let coordinator = context.coordinator
        coordinator.closed = closed
        coordinator.forgetIfGone()
        if let url, coordinator.shown == nil {
            let safari = SFSafariViewController(url: url)
            safari.preferredBarTintColor = UIColor(Palette.bg)
            safari.preferredControlTintColor = UIColor(Palette.primaryText)
            safari.delegate = coordinator
            coordinator.shown = safari
            coordinator.presenting = true
            // After this update, so a SwiftUI change in flight has landed.
            DispatchQueue.main.async { coordinator.present(safari, from: anchor) }
        } else if url == nil, let shown = coordinator.shown {
            coordinator.shown = nil
            Coordinator.takeDown(shown)
        }
    }

    static func dismantleUIViewController(_ anchor: UIViewController, coordinator: Coordinator) {
        if let shown = coordinator.shown { Coordinator.takeDown(shown) }
        coordinator.shown = nil
    }

    func makeCoordinator() -> Coordinator { Coordinator(closed: closed) }

    @MainActor
    final class Coordinator: NSObject, @preconcurrency SFSafariViewControllerDelegate,
        @preconcurrency UIAdaptivePresentationControllerDelegate
    {
        var closed: () -> Void
        var shown: SFSafariViewController?
        /// Between asking and UIKit taking it: not presented yet, not gone.
        var presenting = false

        init(closed: @escaping () -> Void) { self.closed = closed }

        func present(_ safari: SFSafariViewController, from anchor: UIViewController) {
            guard shown === safari else { return }
            presenting = false
            guard let window = anchor.view.window ?? Self.keyWindow, var top = window.rootViewController else {
                return gone(safari)
            }
            while let above = top.presentedViewController, !above.isBeingDismissed { top = above }
            safari.presentationController?.delegate = self
            top.present(safari, animated: true)
            // Refused (something above still closing): free the link again.
            if safari.presentingViewController == nil, !safari.isBeingPresented { gone(safari) }
        }

        /// Safari went without telling us (taken down with the screen or
        /// sheet it sat on): free the link, so the next tap opens it again.
        func forgetIfGone() {
            guard let shown, !presenting, shown.presentingViewController == nil, !shown.isBeingPresented
            else { return }
            gone(shown)
        }

        private func gone(_ safari: SFSafariViewController) {
            guard shown === safari else { return }
            shown = nil
            closed()
        }

        /// Only Safari, and only while it's up: a dismiss sent to a view
        /// controller that isn't presented goes to the one under it.
        static func takeDown(_ safari: SFSafariViewController) {
            guard safari.presentingViewController != nil, !safari.isBeingDismissed else { return }
            safari.dismiss(animated: true)
        }

        private static var keyWindow: UIWindow? {
            UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows).first(where: \.isKeyWindow)
        }

        /// Done: Safari takes itself down (presented by UIKit, it does).
        func safariViewControllerDidFinish(_ controller: SFSafariViewController) { gone(controller) }

        /// Closed by a gesture, where Safari's presentation has one.
        func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
            if let safari = presentationController.presentedViewController as? SFSafariViewController {
                gone(safari)
            }
        }
    }
}
