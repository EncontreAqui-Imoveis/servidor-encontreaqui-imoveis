import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/notification_model.dart';
import '../providers/auth_provider.dart';
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  static const routeName = '/notifications';

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  late Future<List<NotificationModel>> _notificationsFuture;

  static const String _baseUrl =
      'https://backend-production-6acc.up.railway.app';

  @override
  void initState() {
    super.initState();
    _notificationsFuture = _fetchNotifications();
  }

  Future<List<NotificationModel>> _fetchNotifications() async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final token = auth.token;

    if (token == null) {
      auth.enterAsGuest();
      throw Exception('Sessão expirada. Faça login novamente.');
    }

    final uri = Uri.parse('$_baseUrl/users/notifications');
    final response =
        await http.get(uri, headers: {'Authorization': 'Bearer $token'});

    if (response.statusCode == 401) {
      await auth.logout();
      throw Exception('Sessão expirada. Faça login novamente.');
    }

    if (response.statusCode != 200) {
      final decoded =
          response.body.isEmpty ? null : json.decode(response.body);
      final message = decoded is Map<String, dynamic>
          ? (decoded['error'] as String?) ?? 'Falha ao carregar notificações.'
          : 'Falha ao carregar notificações.';
      throw Exception(message);
    }

    final decoded = json.decode(response.body);
    final List<dynamic> items;

    if (decoded is List) {
      items = decoded;
    } else if (decoded is Map<String, dynamic>) {
      items = (decoded['data'] as List?) ??
          (decoded['notifications'] as List?) ??
          const [];
    } else {
      throw Exception('Formato de resposta inesperado.');
    }

    return items
        .map((item) =>
            NotificationModel.fromJson(Map<String, dynamic>.from(item)))
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Minhas Notificações'),
      ),
      body: FutureBuilder<List<NotificationModel>>(
        future: _notificationsFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          if (snapshot.hasError) {
            return _ErrorState(
              message: snapshot.error.toString(),
              onRetry: () {
                setState(() {
                  _notificationsFuture = _fetchNotifications();
                });
              },
            );
          }

          final notifications = snapshot.data ?? const <NotificationModel>[];
          if (notifications.isEmpty) {
            return const _EmptyState();
          }

          final formatter = DateFormat("dd/MM/yyyy 'às' HH:mm", 'pt_BR');

          return ListView.builder(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            itemCount: notifications.length,
            itemBuilder: (context, index) {
              final notification = notifications[index];
              final badge = _resolveBadge(notification.relatedEntityType);

              return Card(
                margin: const EdgeInsets.only(bottom: 12),
                child: ListTile(
                  leading: CircleAvatar(
                    backgroundColor: badge.color.withOpacity(0.1),
                    foregroundColor: badge.color,
                    child: Icon(badge.icon),
                  ),
                  title: Text(
                    notification.message,
                    style: theme.textTheme.bodyLarge?.copyWith(
                      fontWeight: notification.isRead
                          ? FontWeight.w400
                          : FontWeight.w600,
                    ),
                  ),
                  subtitle: Text(
                    formatter.format(notification.createdAt),
                    style: theme.textTheme.bodySmall,
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }

  _NotificationBadge _resolveBadge(String type) {
    switch (type.toLowerCase()) {
      case 'property':
        return const _NotificationBadge(
          icon: Icons.home_outlined,
          color: Colors.indigo,
        );
      case 'broker':
        return const _NotificationBadge(
          icon: Icons.badge_outlined,
          color: Colors.teal,
        );
      default:
        return const _NotificationBadge(
          icon: Icons.notifications_outlined,
          color: Colors.deepPurple,
        );
    }
  }
}

class _NotificationBadge {
  const _NotificationBadge({required this.icon, required this.color});

  final IconData icon;
  final Color color;
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.mark_email_read_outlined,
                size: 48, color: theme.colorScheme.primary),
            const SizedBox(height: 16),
            Text(
              'Nenhuma notificação por aqui ainda.',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w600,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              'Assim que surgirem novidades sobre imóveis e oportunidades para você, elas aparecerão aqui.',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.hintColor,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline,
                size: 56, color: theme.colorScheme.error),
            const SizedBox(height: 16),
            Text(
              message,
              style: theme.textTheme.titleMedium
                  ?.copyWith(fontWeight: FontWeight.w600),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Tentar novamente'),
            ),
          ],
        ),
      ),
    );
  }
}
