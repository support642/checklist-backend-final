import db from '../../config/db.js';

export const getAssetUsers = async (req, res) => {
    try {
        const query = 'SELECT id, user_name FROM users ORDER BY user_name ASC';
        const { rows } = await db.query(query);
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching users for assets:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
