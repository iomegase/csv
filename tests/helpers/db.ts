import { afterAll, afterEach, beforeAll } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { connectToDatabase, disconnectFromDatabase } from '@/lib/mongodb'

/**
 * Démarre un MongoDB en mémoire en replica set à un nœud pour le fichier de
 * test courant, et vide les collections entre chaque test.
 *
 * Le replica set est obligatoire : un MongoMemoryServer standalone refuserait
 * les transactions, exactement comme le mongod du port 27017.
 */
export function withTestDatabase() {
  let replSet: MongoMemoryReplSet

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    process.env.MONGODB_URI = replSet.getUri('lecteur-csv-test')
    await connectToDatabase()
  })

  afterEach(async () => {
    const collections = await mongoose.connection.db!.collections()
    // deleteMany plutôt que drop : drop supprimerait aussi les index, dont
    // l'index unique partiel sur isActive que plusieurs tests vérifient.
    await Promise.all(collections.map((collection) => collection.deleteMany({})))
  })

  afterAll(async () => {
    await disconnectFromDatabase()
    await replSet.stop()
  })
}
