import mongoose from 'mongoose'

interface MongooseCache {
  conn: typeof mongoose | null
  promise: Promise<typeof mongoose> | null
}

// Next.js réévalue les modules à chaque rechargement à chaud. Sans ce cache
// porté par globalThis, chaque édition de fichier ouvrirait une connexion de
// plus jusqu'à saturer le pool de MongoDB.
declare global {
  var _mongooseCache: MongooseCache | undefined
}

const cache: MongooseCache = globalThis._mongooseCache ?? { conn: null, promise: null }
globalThis._mongooseCache = cache

export async function connectToDatabase(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn

  if (!cache.promise) {
    // Lu à l'appel et non au chargement du module : les tests renseignent
    // l'URI après l'import.
    const uri = process.env.MONGODB_URI

    if (!uri) {
      throw new Error(
        'MONGODB_URI manquant. Copiez .env.example vers .env.local, puis lancez npm run mongo:start.',
      )
    }

    cache.promise = mongoose.connect(uri, { bufferCommands: false })
  }

  try {
    cache.conn = await cache.promise
  } catch (error) {
    // Sans cette remise à zéro, une première connexion en échec serait
    // renvoyée indéfiniment par le cache.
    cache.promise = null
    throw error
  }

  return cache.conn
}

export async function disconnectFromDatabase(): Promise<void> {
  if (!cache.conn) return
  await mongoose.disconnect()
  cache.conn = null
  cache.promise = null
}
