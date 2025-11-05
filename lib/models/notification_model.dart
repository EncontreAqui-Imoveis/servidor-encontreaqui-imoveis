class NotificationModel {
  const NotificationModel({
    required this.id,
    required this.message,
    required this.relatedEntityType,
    required this.isRead,
    required this.createdAt,
    this.relatedEntityId,
    this.recipientId,
  });

  final int id;
  final String message;
  final String relatedEntityType;
  final int? relatedEntityId;
  final int? recipientId;
  final bool isRead;
  final DateTime createdAt;

  factory NotificationModel.fromJson(Map<String, dynamic> json) {
    return NotificationModel(
      id: json['id'] as int,
      message: (json['message'] ?? '') as String,
      relatedEntityType: (json['related_entity_type'] ?? '') as String,
      isRead: json['is_read'] == true || json['is_read'] == 1,
      createdAt: DateTime.parse(json['created_at'] as String),
      relatedEntityId: json['related_entity_id'] as int?,
      recipientId: json['recipient_id'] as int?,
    );
  }
}
