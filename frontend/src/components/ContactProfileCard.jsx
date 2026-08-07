import * as React from 'react';
import {
  Card,
  CardHeader,
  Text,
  Avatar,
  Badge,
  Button,
  makeStyles,
  tokens,
  Divider,
  Skeleton,
  SkeletonItem,
} from '@fluentui/react-components';
import {
  MailRegular,
  CallRegular,
  ChatRegular,
  CalendarRegular,
} from '@fluentui/react-icons';

const useStyles = makeStyles({
  card: {
    width: '420px',
    maxWidth: '100%',
    // Glassmorphism effect overlaying the dark theme
    backgroundColor: 'rgba(36, 36, 36, 0.65)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    border: `1px solid rgba(255, 255, 255, 0.08)`,
    boxShadow: tokens.shadow16,
    borderRadius: tokens.borderRadiusXLarge,
    padding: '24px',
  },
  headerAction: {
    display: 'flex',
    gap: '8px',
  },
  tagsContainer: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    marginTop: '8px',
    marginBottom: '16px',
  },
  summary: {
    color: tokens.colorNeutralForeground2,
    lineHeight: '1.6',
    marginTop: '4px',
    marginBottom: '16px',
  },
  timeline: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0px', // Managed by the line height
    marginTop: '12px',
  },
  timelineItem: {
    display: 'flex',
    gap: '16px',
  },
  timelineIcon: {
    color: tokens.colorNeutralForeground3,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    marginTop: '2px',
  },
  timelineLine: {
    width: '1px',
    flexGrow: 1,
    backgroundColor: tokens.colorNeutralStroke3,
    minHeight: '24px',
    margin: '4px 0',
  },
  timelineContent: {
    display: 'flex',
    flexDirection: 'column',
    paddingBottom: '16px',
  },
  sectionTitle: {
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    fontSize: '11px',
    fontWeight: '600',
    color: tokens.colorNeutralForeground4,
    marginBottom: '8px',
    display: 'block',
  },
  actionsRow: {
    display: 'flex',
    gap: '12px',
    marginTop: '16px',
  }
});

export const ContactProfileCard = ({ contact }) => {
  const styles = useStyles();

  if (!contact) return null;

  return (
    <Card className={styles.card} appearance="outline">
      <CardHeader
        image={<Avatar name={contact.name || ''} image={contact.avatar_url ? { src: contact.avatar_url } : undefined} size={64} />}
        header={<Text weight="semibold" size={500}>{contact.name || 'Unknown'}</Text>}
        description={<Text size={200} color="neutral-secondary">{[contact.jobTitle, contact.company].filter(Boolean).join(' @ ') || 'Contact Profile'}</Text>}
      />
      
      <div className={styles.actionsRow}>
        <Button icon={<MailRegular />} size="small" appearance="subtle">Email</Button>
        <Button icon={<CallRegular />} size="small" appearance="subtle">Call</Button>
        <Button icon={<ChatRegular />} size="small" appearance="subtle">Message</Button>
      </div>

      <Divider style={{ margin: '20px 0' }} />

      <div>
        <Text className={styles.sectionTitle}>AI-Extracted Insights</Text>
        <div className={styles.tagsContainer}>
          {contact.ai_insights ? (
            contact.ai_insights.map((tag, i) => (
              <Badge key={i} color={tag.color} appearance="filled" shape="rounded">
                {tag.label}
              </Badge>
            ))
          ) : (
            <Skeleton className={styles.tagsContainer} style={{ marginTop: 0, marginBottom: 0 }}>
              <SkeletonItem shape="rectangle" style={{ width: '60px', height: '20px', borderRadius: '4px' }} />
              <SkeletonItem shape="rectangle" style={{ width: '80px', height: '20px', borderRadius: '4px' }} />
              <SkeletonItem shape="rectangle" style={{ width: '70px', height: '20px', borderRadius: '4px' }} />
            </Skeleton>
          )}
        </div>
      </div>

      <div>
        <Text className={styles.sectionTitle}>AI-Generated Summary</Text>
        <div className={styles.summary}>
          {contact.ai_summary ? (
            <Text size={200}>{contact.ai_summary}</Text>
          ) : (
            <Skeleton>
              <SkeletonItem style={{ width: '100%', height: '14px', marginBottom: '6px' }} />
              <SkeletonItem style={{ width: '90%', height: '14px', marginBottom: '6px' }} />
              <SkeletonItem style={{ width: '40%', height: '14px' }} />
            </Skeleton>
          )}
        </div>
      </div>

      <Divider style={{ margin: '20px 0' }} />

      <div>
        <Text className={styles.sectionTitle}>Interaction Timeline</Text>
        <div className={styles.timeline}>
          {contact.timeline ? (
            contact.timeline.map((item, i) => (
              <div key={item.id} className={styles.timelineItem}>
                <div className={styles.timelineIcon}>
                  {item.source === 'calendar' ? <CalendarRegular fontSize={16} /> : <MailRegular fontSize={16} />}
                  {i !== contact.timeline.length - 1 && <div className={styles.timelineLine} />}
                </div>
                <div className={styles.timelineContent}>
                  <Text weight="semibold" size={200}>{item.title}</Text>
                  <Text size={100} color="neutral-secondary">
                    {new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {item.source}
                  </Text>
                </div>
              </div>
            ))
          ) : (
            <Skeleton style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', gap: '16px' }}>
                <SkeletonItem shape="circle" style={{ width: '16px', height: '16px' }} />
                <div style={{ flex: 1 }}>
                  <SkeletonItem style={{ width: '60%', height: '14px', marginBottom: '4px' }} />
                  <SkeletonItem style={{ width: '30%', height: '10px' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '16px' }}>
                <SkeletonItem shape="circle" style={{ width: '16px', height: '16px' }} />
                <div style={{ flex: 1 }}>
                  <SkeletonItem style={{ width: '80%', height: '14px', marginBottom: '4px' }} />
                  <SkeletonItem style={{ width: '40%', height: '10px' }} />
                </div>
              </div>
            </Skeleton>
          )}
        </div>
      </div>
    </Card>
  );
};
