// copy-style.test.ts: a retired phrase in a string is caught (lines 8, 9 and
// the multi-line string from 11); everywhere else it is not. Not a real app file.
import SwiftUI

struct Fixture: View {
    let seamlessUpload = true // identifier: not text
    var body: some View {
        Text("A seamless upload")
        Text("Upload failed")
        print("Upload failed")
        Text("""
        Boat attitude
        """)
        Text(seamlessUpload ? "Saved" : "Couldn't save. Please try again.")
        Image(systemName: "lock.unlock")
        Text("\(seamlessUpload) Your paddles")
    }
}
