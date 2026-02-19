import { Router } from 'express';
import userRoutes from './user.routes';
import propertyRoutes from './property.routes';
import brokerRoutes from './broker.routes';
import adminRoutes from './admin.routes';
import dashboardRoutes from './dashboard.routes'
import authRoutes from './auth.routes';
import negotiationRoutes from './negotiation.routes';
import locationRoutes from './location.routes';
import contractRoutes from './contract.routes';

const mainRoutes = Router();

mainRoutes.get('/', (req, res) => {
    return res.json({ message: 'API Imobiliária no ar!' });
});

mainRoutes.use('/auth', authRoutes);
mainRoutes.use('/users', userRoutes);
mainRoutes.use('/brokers', brokerRoutes);
mainRoutes.use('/properties', propertyRoutes);
mainRoutes.use('/negotiations', negotiationRoutes);
mainRoutes.use('/locations', locationRoutes);
mainRoutes.use('/admin', adminRoutes);
mainRoutes.use('/admin/dashboard', dashboardRoutes); 
mainRoutes.use(contractRoutes);

export default mainRoutes;
