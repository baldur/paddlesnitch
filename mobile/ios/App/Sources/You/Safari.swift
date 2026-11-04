import DesignSystem
import SafariServices
import SwiftUI

extension View {
    /// The website inside the app, in Safari's own view, while `url` is set;
    /// `closed` clears it once Safari has gone. Presented by UIKit, the way
    /// Safari's view is made to be shown, so its Done takes down exactly
    /// Safari. Inside a SwiftUI sheet it didn't: on iOS 17 Done closed
    /// nothing (from Account, and from a sheet on a sheet), and on newer iOS
    /// closing that sheet again took the screen under it too (#878).
    func safari(url: URL?, closed: @escaping () -> Void) -> some View {
        background(SafariPresenter(url: url, closed: closed))
    }
}

/// An empty view controller on the screen that opens the page. It presents
/// Safari from whatever is on top above it, and takes Safari down if the
/// app clears `url` first (a sign-out) or the screen goes.
private struct SafariPresenter: UIViewControllerRepresentable {
    let url: URL?
    let closed: () -> Void

    func makeUIViewController(context: Context) -> UIViewController { UIViewController() }

    func updateUIViewController(_ anchor: UIViewController, context: Context) {
        let coordinator = context.coordinator
        coordinator.closed = closed
        if let url, coordinator.shown == nil {
            let safari = SFSafariViewController(url: url)
            safari.preferredBarTintColor = UIColor(Palette.bg)
            safari.preferredControlTintColor = UIColor(Palette.primaryText)
            safari.delegate = coordinator
            coordinator.shown = safari
            // After this update, once the anchor is in its window.
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

    @MainActor final class Coordinator: NSObject, @preconcurrency SFSafariViewControllerDelegate {
        var closed: () -> Void
        var shown: SFSafariViewController?

        init(closed: @escaping () -> Void) { self.closed = closed }

        func present(_ safari: SFSafariViewController, from anchor: UIViewController) {
            guard shown === safari else { return }
            guard anchor.view.window != nil else {
                shown = nil
                return closed()
            }
            var top = anchor
            while let above = top.presentedViewController, !above.isBeingDismissed { top = above }
            top.present(safari, animated: true)
        }

        /// Only Safari, and only while it's up: a dismiss sent to a view
        /// controller that isn't presented goes to the one under it.
        static func takeDown(_ safari: SFSafariViewController) {
            guard safari.presentingViewController != nil, !safari.isBeingDismissed else { return }
            safari.dismiss(animated: true)
        }

        /// Safari has taken itself down (presented by UIKit, Done does).
        func safariViewControllerDidFinish(_ controller: SFSafariViewController) {
            guard shown === controller else { return }
            shown = nil
            closed()
        }
    }
}
