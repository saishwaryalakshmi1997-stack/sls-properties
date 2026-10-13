import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DashboardScreen from '../screens/DashboardScreen';
import RentReportScreen from '../screens/RentReportScreen';
import AddPropertyScreen from '../screens/AddPropertyScreen';
import { Colors } from '../theme/colors';

export type RootTabParamList = {
  Dashboard: { propertyId?: number } | undefined;
  'Rent Report': { propertyId?: number } | undefined;
  'Add Property': { propertyId?: number; buildingName?: string } | undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

export default function AppNavigator() {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.tabInactive,
        tabBarStyle: {
          backgroundColor: Colors.card,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
          height: insets.bottom > 0 ? 60 + insets.bottom : 64,
          paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons
              name="view-dashboard-outline"
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Rent Report"
        component={RentReportScreen}
        options={{
          title: 'Rent Report',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons
              name="table-large"
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Add Property"
        component={AddPropertyScreen}
        options={{
          tabBarButton: () => null,
          tabBarItemStyle: { display: 'none' },
          tabBarStyle: { display: 'none' },
        }}
      />
    </Tab.Navigator>
  );
}
