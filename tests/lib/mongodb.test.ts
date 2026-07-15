import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { connectToDatabase, disconnectFromDatabase } from '@/lib/mongodb'

let replSet: MongoMemoryReplSet

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
  process.env.MONGODB_URI = replSet.getUri('lecteur-csv-test')
})

afterAll(async () => {
  await disconnectFromDatabase()
  await replSet.stop()
})

describe('connectToDatabase', () => {
  it('se connecte et réutilise la même connexion', async () => {
    const first = await connectToDatabase()
    const second = await connectToDatabase()

    expect(first.connection.readyState).toBe(1)
    expect(second).toBe(first)
  })

  it('expose un replica set, donc des transactions utilisables', async () => {
    await connectToDatabase()
    const session = await mongoose.startSession()

    // Le vrai test du replica set : sur un standalone, startTransaction est
    // accepté mais le commit échoue avec NoReplicationEnabled. On vérifie
    // ici que le commit a bien eu lieu (le document existe après coup),
    // plutôt que la valeur de retour de withTransaction : avec le driver
    // mongodb en usage ici, elle vaut la valeur renvoyée par le callback
    // (donc undefined pour un callback qui ne retourne rien), pas un
    // indicateur de succès en soi.
    await session.withTransaction(async () => {
      await mongoose.connection.db!.collection('probe').insertOne({ ok: 1 }, { session })
    })
    await session.endSession()

    const count = await mongoose.connection.db!.collection('probe').countDocuments({ ok: 1 })
    expect(count).toBe(1)
  })

  it('échoue clairement sans MONGODB_URI', async () => {
    const saved = process.env.MONGODB_URI
    delete process.env.MONGODB_URI
    await disconnectFromDatabase()

    await expect(connectToDatabase()).rejects.toThrow(/MONGODB_URI/)

    process.env.MONGODB_URI = saved
  })
})
