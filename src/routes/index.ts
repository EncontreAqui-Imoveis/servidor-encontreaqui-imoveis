import { Router } from 'express';
import userRoutes from './user.routes';
import propertyRoutes from './property.routes';
import brokerRoutes from './broker.routes';
import adminRoutes from './admin.routes';
import dashboardRoutes from './dashboard.routes'
import authRoutes from './auth.routes';
import negotiationsRoutes from '../modules/negociacoes/http/negotiations.routes';

const mainRoutes = Router();

mainRoutes.get('/', (req, res) => {
    return res.json({ message: 'API Imobiliária no ar!' });
});

mainRoutes.use('/auth', authRoutes);
mainRoutes.use('/users', userRoutes);
mainRoutes.use('/brokers', brokerRoutes);
mainRoutes.use('/properties', propertyRoutes);
mainRoutes.use('/negotiations', negotiationsRoutes);
mainRoutes.use('/admin', adminRoutes);
mainRoutes.use('/admin/dashboard', dashboardRoutes); 

export default mainRoutes;
