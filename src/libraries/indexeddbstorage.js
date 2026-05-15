const DB_NAME = "MidiAudioPlayer";
const STORE_NAME = "KeyValues";
const DB_VERSION = 1;

let dbInstance = null;

async function getDB() {
	if (dbInstance) return dbInstance;
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = (e) => {
			const db = e.target.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME);
			}
		};
		request.onsuccess = (e) => {
			dbInstance = e.target.result;
			resolve(dbInstance);
		};
		request.onerror = (e) => reject(e.target.error);
	});
}


export default indexedDbStorage = {

	async setItem(key, value) {
		const db = await getDB();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE_NAME, "readwrite");
			const store = transaction.objectStore(STORE_NAME);
			const request = store.put(value, key);
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	},


	async getItem(key) {
		const db = await getDB();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE_NAME, "readonly");
			const store = transaction.objectStore(STORE_NAME);
			const request = store.get(key);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	},


	async removeItem(key) {
		const db = await getDB();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE_NAME, "readwrite");
			const store = transaction.objectStore(STORE_NAME);
			const request = store.delete(key);
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	},


	async clear() {
		const db = await getDB();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE_NAME, "readwrite");
			const store = transaction.objectStore(STORE_NAME);
			const request = store.clear();
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	}
};