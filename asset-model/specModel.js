import db from '../config/asset-db.js';

class SpecModel {
    static async getSpecsByProductId(productId) {
        const query = 'SELECT spec_name as name, spec_value as value FROM product_specs WHERE product_id = $1';
        const { rows } = await db.query(query, [productId]);
        return rows;
    }

    static async addSpecsToProduct(productId, specsArray) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');
            
            // Delete existing specs to replace them (simplified approach for arrays mapping)
            await client.query('DELETE FROM product_specs WHERE product_id = $1', [productId]);
            
            for (let spec of specsArray) {
                const specName = typeof spec === 'string' ? spec : (spec.name || spec.value || '');
                const specValue = typeof spec === 'string' ? '' : (spec.value || '');
                if (specName && String(specName).trim()) {
                    await client.query(
                        'INSERT INTO product_specs (product_id, spec_name, spec_value) VALUES ($1, $2, $3)',
                        [productId, String(specName).trim(), specValue ? String(specValue).trim() : '']
                    );
                }
            }

            await client.query('COMMIT');
            return specsArray;
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }
}

export default SpecModel;
