package os.nude.browser

import os.rovian.core.Security

import android.app.Application

class NudeApplication : Application() {
    lateinit var store: Store
        private set
    lateinit var accounts: Accounts
        private set

    override fun onCreate() {
        super.onCreate()
        store = Store(this)
        accounts = Accounts(this)
        Security.trusted.addAll(store.trusted())
    }
}
