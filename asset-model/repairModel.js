import db from '../config/asset-db.js';

class RepairModel {
    static async getRepairsByProductId(productId) {
        const query = `
            SELECT r.*, 
                   (SELECT json_agg(rp.part_name) FROM repair_parts rp WHERE rp.repair_id = r.id) as part_names
            FROM repairs r 
            WHERE r.product_id = $1
            ORDER BY r.repair_date DESC;
        `;
        const { rows } = await db.query(query, [productId]);
        return rows.map(r => ({
            id: r.id,
            productId: r.product_id,
            repairDate: r.repair_date,
            repairCost: r.repair_cost,
            partChanged: r.part_changed,
            totalRepairCost: r.total_repair_cost,
            partNames: r.part_names || []
        }));
    }

    static async addRepairToProduct(productId, data) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');
            
            const repQuery = `
                INSERT INTO repairs (product_id, repair_date, repair_cost, part_changed, total_repair_cost)
                VALUES ($1, $2, $3, $4, $5) RETURNING id;
            `;
            const repRes = await client.query(repQuery, [
                productId, 
                data.repairDate ? new Date(data.repairDate) : null,
                data.repairCost || 0,
                data.partChanged,
                data.totalRepairCost || 0
            ]);

            const repairId = repRes.rows[0].id;

            if (data.partNames && Array.isArray(data.partNames)) {
                for (let part of data.partNames) {
                    await client.query(
                        'INSERT INTO repair_parts (repair_id, part_name) VALUES ($1, $2)', 
                        [repairId, part]
                    );
                }
            }

            await client.query('COMMIT');
            return { id: repairId, productId, ...data };
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }
}

export default RepairModel;
