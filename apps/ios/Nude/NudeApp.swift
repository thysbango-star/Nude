import SwiftUI

@main
@MainActor
struct NudeApp: App {
    @StateObject private var store: Store
    @StateObject private var model: BrowserModel
    @StateObject private var accounts = Accounts()

    init() {
        let s = Store()
        _store = StateObject(wrappedValue: s)
        _model = StateObject(wrappedValue: BrowserModel(store: s))
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
                .environmentObject(model)
                .environmentObject(accounts)
                .tint(nudeClay)
                .preferredColorScheme(store.theme == "dark" ? .dark : store.theme == "light" ? .light : nil)
        }
    }
}
