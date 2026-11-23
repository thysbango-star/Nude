package os.nude.browser

import os.rovian.core.Security

import android.app.Application

class NudeApplication : Application() {
    lateinit var store: Store
        private set
    lateinit var accounts: Accounts
        private set
    lateinit var groq: GroqNebula
        private set
    lateinit var chats: NebulaChats
        private set

    override fun onCreate() {
        super.onCreate()
        store = Store(this)
        accounts = Accounts(this)
        groq = GroqNebula(this)
        chats = NebulaChats(this, accounts.id)
        Security.trusted.addAll(store.trusted())
    }
}
