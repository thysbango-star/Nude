package os.nude.browser

import android.app.Application

class NudeApplication : Application() {
    lateinit var store: Store
        private set

    override fun onCreate() {
        super.onCreate()
        store = Store(this)
        Security.trusted.addAll(store.trusted())
    }
}
