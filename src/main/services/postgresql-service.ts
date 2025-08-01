import { Pool, PoolClient, QueryResult } from 'pg'
import * as keytar from 'keytar'
import { PostgreSQLConfig, PostgreSQLConnectionResult, PostgreSQLQueryResult } from '../../shared/ipc-types'

const SERVICE_NAME = 'ArionPostgreSQLCredentials'

export class PostgreSQLService {
  private pools: Map<string, Pool> = new Map()
  private readonly maxConnections = 10
  private readonly connectionTimeout = 30000
  private readonly idleTimeout = 30000

  constructor() {
    console.log('[PostgreSQLService] Initialized')
  }

  async testConnection(config: PostgreSQLConfig): Promise<PostgreSQLConnectionResult> {
    console.log(`[PostgreSQLService] Testing connection to ${config.host}:${config.port}/${config.database}`)
    
    let client: PoolClient | null = null
    
    try {
      // Create a temporary pool for testing
      const tempPool = new Pool({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.username,
        password: config.password,
        ssl: config.ssl,
        max: 1,
        connectionTimeoutMillis: this.connectionTimeout,
        idleTimeoutMillis: this.idleTimeout
      })

      client = await tempPool.connect()
      
      // Test basic connection
      const result = await client.query('SELECT version()')
      const version = result.rows[0]?.version || 'Unknown'
      
      // Test PostGIS availability
      let postgisVersion: string | null = null
      try {
        const postgisResult = await client.query('SELECT PostGIS_Version()')
        postgisVersion = postgisResult.rows[0]?.postgis_version || null
      } catch (error) {
        console.log('[PostgreSQLService] PostGIS not available:', error)
      }

      await tempPool.end()

      return {
        success: true,
        version,
        postgisVersion,
        message: 'Connection successful'
      }
    } catch (error) {
      console.error('[PostgreSQLService] Connection test failed:', error)
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown connection error'
      }
    } finally {
      if (client) {
        client.release()
      }
    }
  }

  async createConnection(id: string, config: PostgreSQLConfig): Promise<PostgreSQLConnectionResult> {
    console.log(`[PostgreSQLService] Creating connection pool for ${id}`)
    
    try {
      // Close existing connection if it exists
      await this.closeConnection(id)

      // Store credentials securely
      await this.storeCredentials(id, config)

      // Create new connection pool
      const pool = new Pool({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.username,
        password: config.password,
        ssl: config.ssl,
        max: this.maxConnections,
        connectionTimeoutMillis: this.connectionTimeout,
        idleTimeoutMillis: this.idleTimeout
      })

      // Test the connection
      const testResult = await this.testConnection(config)
      if (!testResult.success) {
        await pool.end()
        return testResult
      }

      this.pools.set(id, pool)
      
      return {
        success: true,
        version: testResult.version,
        postgisVersion: testResult.postgisVersion,
        message: 'Connection pool created successfully'
      }
    } catch (error) {
      console.error(`[PostgreSQLService] Failed to create connection pool for ${id}:`, error)
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error creating connection'
      }
    }
  }

  async closeConnection(id: string): Promise<void> {
    console.log(`[PostgreSQLService] Closing connection pool for ${id}`)
    
    const pool = this.pools.get(id)
    if (pool) {
      await pool.end()
      this.pools.delete(id)
    }
    
    // Remove stored credentials
    await this.removeCredentials(id)
  }

  async executeQuery(id: string, query: string, params?: any[]): Promise<PostgreSQLQueryResult> {
    console.log(`[PostgreSQLService] Executing query on connection ${id}`)
    
    const pool = this.pools.get(id)
    if (!pool) {
      return {
        success: false,
        message: `No active connection found for ${id}`
      }
    }

    let client: PoolClient | null = null
    
    try {
      client = await pool.connect()
      
      const startTime = Date.now()
      const result: QueryResult = await client.query(query, params)
      const executionTime = Date.now() - startTime
      
      return {
        success: true,
        rows: result.rows,
        rowCount: result.rowCount || 0,
        fields: result.fields?.map(field => ({
          name: field.name,
          dataTypeID: field.dataTypeID,
          dataTypeSize: field.dataTypeSize,
          dataTypeModifier: field.dataTypeModifier,
          format: field.format
        })) || [],
        executionTime,
        message: `Query executed successfully in ${executionTime}ms`
      }
    } catch (error) {
      console.error(`[PostgreSQLService] Query execution failed for ${id}:`, error)
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown query execution error'
      }
    } finally {
      if (client) {
        client.release()
      }
    }
  }

  async executeTransaction(id: string, queries: string[]): Promise<PostgreSQLQueryResult> {
    console.log(`[PostgreSQLService] Executing transaction on connection ${id}`)
    
    const pool = this.pools.get(id)
    if (!pool) {
      return {
        success: false,
        message: `No active connection found for ${id}`
      }
    }

    let client: PoolClient | null = null
    
    try {
      client = await pool.connect()
      
      const startTime = Date.now()
      await client.query('BEGIN')
      
      const results: any[] = []
      for (const query of queries) {
        const result = await client.query(query)
        results.push(result.rows)
      }
      
      await client.query('COMMIT')
      const executionTime = Date.now() - startTime
      
      return {
        success: true,
        rows: results,
        rowCount: results.reduce((sum, rows) => sum + rows.length, 0),
        fields: [],
        executionTime,
        message: `Transaction executed successfully in ${executionTime}ms`
      }
    } catch (error) {
      if (client) {
        try {
          await client.query('ROLLBACK')
        } catch (rollbackError) {
          console.error(`[PostgreSQLService] Rollback failed for ${id}:`, rollbackError)
        }
      }
      
      console.error(`[PostgreSQLService] Transaction failed for ${id}:`, error)
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown transaction error'
      }
    } finally {
      if (client) {
        client.release()
      }
    }
  }

  async getActiveConnections(): Promise<string[]> {
    return Array.from(this.pools.keys())
  }

  async getConnectionInfo(id: string): Promise<{ connected: boolean; config?: PostgreSQLConfig }> {
    const pool = this.pools.get(id)
    if (!pool) {
      return { connected: false }
    }

    try {
      const config = await this.getStoredCredentials(id)
      return {
        connected: true,
        config: config || undefined
      }
    } catch (error) {
      console.error(`[PostgreSQLService] Failed to get connection info for ${id}:`, error)
      return { connected: false }
    }
  }

  private async storeCredentials(id: string, config: PostgreSQLConfig): Promise<void> {
    try {
      const credentialsKey = `${SERVICE_NAME}_${id}`
      const credentials = JSON.stringify({
        host: config.host,
        port: config.port,
        database: config.database,
        username: config.username,
        password: config.password,
        ssl: config.ssl
      })
      
      await keytar.setPassword(SERVICE_NAME, credentialsKey, credentials)
    } catch (error) {
      console.error(`[PostgreSQLService] Failed to store credentials for ${id}:`, error)
      throw error
    }
  }

  private async getStoredCredentials(id: string): Promise<PostgreSQLConfig | null> {
    try {
      const credentialsKey = `${SERVICE_NAME}_${id}`
      const credentials = await keytar.getPassword(SERVICE_NAME, credentialsKey)
      
      if (!credentials) {
        return null
      }
      
      return JSON.parse(credentials) as PostgreSQLConfig
    } catch (error) {
      console.error(`[PostgreSQLService] Failed to retrieve credentials for ${id}:`, error)
      return null
    }
  }

  private async removeCredentials(id: string): Promise<void> {
    try {
      const credentialsKey = `${SERVICE_NAME}_${id}`
      await keytar.deletePassword(SERVICE_NAME, credentialsKey)
    } catch (error) {
      console.error(`[PostgreSQLService] Failed to remove credentials for ${id}:`, error)
    }
  }

  async cleanup(): Promise<void> {
    console.log('[PostgreSQLService] Cleaning up all connections')
    
    for (const [id, pool] of this.pools) {
      try {
        await pool.end()
        console.log(`[PostgreSQLService] Closed connection pool for ${id}`)
      } catch (error) {
        console.error(`[PostgreSQLService] Error closing connection pool for ${id}:`, error)
      }
    }
    
    this.pools.clear()
  }
}