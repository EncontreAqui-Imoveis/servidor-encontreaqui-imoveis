import { Router } from 'express';
import { adminController, sendNotification, getDashboardStats } from '../controllers/AdminController';
import { authMiddleware as authMiddlewareAdmin, isAdmin as isAdminAdmin } from '../middlewares/auth';
import { mediaUpload } from '../middlewares/uploadMiddleware';

const adminRoutes = Router();

adminRoutes.post('/login', adminController.login);

adminRoutes.use(authMiddlewareAdmin, isAdminAdmin);

adminRoutes.post('/notifications/send', sendNotification);
adminRoutes.delete('/notifications/:id', adminController.deleteNotification);
adminRoutes.delete('/notifications', adminController.clearNotifications);

adminRoutes.post(
  '/properties',
  mediaUpload.fields([
    { name: 'images', maxCount: 20 },
    { name: 'video', maxCount: 1 },
  ]),
  adminController.createProperty
);
adminRoutes.get('/users', adminController.getAllUsers);
adminRoutes.post('/users', adminController.createUser);
adminRoutes.delete('/users/:id', adminController.deleteUser);

adminRoutes.get('/clients', adminController.getAllClients);
adminRoutes.put('/clients/:id', adminController.updateClient);

adminRoutes.post('/brokers', adminController.createBroker);
adminRoutes.get('/brokers', adminController.listBrokers);
adminRoutes.get('/brokers/pending', adminController.listPendingBrokers);
adminRoutes.patch('/brokers/:id/approve', adminController.approveBroker);
adminRoutes.patch('/brokers/:id/reject', adminController.rejectBroker);
adminRoutes.patch('/brokers/:id/status', adminController.updateBrokerStatus);
adminRoutes.put('/brokers/:id', adminController.updateBroker);
adminRoutes.delete('/brokers/:id', adminController.deleteBroker);
adminRoutes.get('/brokers/:id/properties', adminController.getBrokerProperties);

adminRoutes.get('/properties-with-brokers', adminController.listPropertiesWithBrokers);
adminRoutes.get('/properties/:id', adminController.getPropertyDetails);
adminRoutes.put('/properties/:id', adminController.updateProperty);
adminRoutes.delete('/properties/:id', adminController.deleteProperty);
adminRoutes.patch('/properties/:id/approve', adminController.approveProperty);
adminRoutes.patch('/properties/:id/reject', adminController.rejectProperty);
adminRoutes.patch('/properties/:id/status', adminController.updatePropertyStatus);
adminRoutes.post(
  '/properties/:id/images',
  mediaUpload.array('images', 20),
  adminController.addPropertyImage
);
adminRoutes.post(
  '/properties/:id/video',
  mediaUpload.single('video'),
  adminController.addPropertyVideo
);
adminRoutes.delete('/properties/:id/video', adminController.deletePropertyVideo);
adminRoutes.delete('/properties/:id/images/:imageId', adminController.deletePropertyImage);

adminRoutes.get('/notifications', adminController.getNotifications);

adminRoutes.get('/dashboard/stats', getDashboardStats);
adminRoutes.get('/stats/dashboard', getDashboardStats);

export default adminRoutes;
